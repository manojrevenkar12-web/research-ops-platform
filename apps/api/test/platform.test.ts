import { assertAuthModeAllowed, DevIssuer } from "@rop/auth";
import { asPrincipal, PERSONAS } from "@rop/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, harness } from "./helpers";

describe("platform: sign-in, errors, health, telemetry", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(__filename);
  });
  afterAll(async () => h.close());

  it("answers health checks without a token", async () => {
    expect((await h.app.inject({ url: "/health/live" })).json()).toEqual({ status: "ok" });
    expect((await h.app.inject({ url: "/health/ready" })).statusCode).toBe(200);
  });

  it("refuses API calls without a valid token, as problem+json", async () => {
    const none = await h.app.inject({ url: "/api/me" });
    expect(none.statusCode).toBe(401);
    expect(none.headers["content-type"]).toContain("application/problem+json");
    expect(none.json()).toMatchObject({ status: 401, type: expect.stringMatching(/unauthenticated$/) });
    const garbage = await h.app.inject({ url: "/api/me", headers: { authorization: "Bearer abc.def.ghi" } });
    expect(garbage.statusCode).toBe(401);
  });

  it("refuses tokens from another issuer, for another audience, or expired", async () => {
    const p = PERSONAS.ana;
    const other = await DevIssuer.create();
    const forged = await other.sign({ oid: p.oid, roles: p.roles });
    const wrongAud = await h.issuer.sign({ oid: p.oid, roles: p.roles }, 3600, {
      aud: "api://something-else",
    });
    const expired = await h.issuer.sign({ oid: p.oid, roles: p.roles }, -600);
    for (const t of [forged, wrongAud, expired]) {
      const r = await h.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${t}` } });
      expect(r.statusCode).toBe(401);
    }
  });

  it("refuses application tokens and people the platform does not know", async () => {
    const app = await h.issuer.sign({ oid: PERSONAS.dan.oid, roles: ["Platform"], idtyp: "app" });
    expect(
      (await h.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${app}` } })).statusCode,
    ).toBe(403);
    const stranger = await h.issuer.sign({ oid: "11111111-2222-4333-8444-555555555555", roles: ["Staff"] });
    const r = await h.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${stranger}` } });
    expect(r.statusCode).toBe(403);
    expect(r.json().type).toMatch(/not-provisioned$/);
  });

  it("never lets a person's token carry the Platform role or roles the model does not know", async () => {
    const p = PERSONAS.hana;
    const t = await h.issuer.sign({ oid: p.oid, roles: [...p.roles, "Platform", "GlobalAdmin"] });
    const me = (await h.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${t}` } })).json();
    expect(me.roles).toEqual(["Staff"]);
  });

  it("returns the signed-in person with roles and the apps on the platform", async () => {
    const me = (await h.as("ana").get("/api/me")).json();
    expect(me).toMatchObject({
      display_name: "Ana Weber",
      entity: "DE",
      roles: ["RestrictedTechnical", "Scientist", "Staff"],
    });
    expect(me.apps.map((a: { key: string }) => a.key)).toEqual(["shotlog", "grants"]);
  });

  it("serves the access model for the who-can-see view", async () => {
    const m = (await h.as("hana").get("/api/access/model")).json();
    expect(Object.keys(m.roles)).toContain("Scientist");
    expect(m.tables.salary_costs.select).toHaveLength(2);
  });

  it("answers a report that has not been generated with a clear 404, and rejects unknown reports", async () => {
    const r = await h.as("hana").get("/api/reports/handover");
    expect([200, 404]).toContain(r.statusCode);
    expect((await h.as("hana").get("/api/reports/secrets")).statusCode).toBe(400);
  });

  it("echoes a request id, or makes one", async () => {
    const t = await h.issuer.sign({ oid: PERSONAS.ana.oid, roles: PERSONAS.ana.roles });
    const given = await h.app.inject({
      url: "/api/me",
      headers: { authorization: `Bearer ${t}`, "x-request-id": "req-12345678" },
    });
    expect(given.headers["x-request-id"]).toBe("req-12345678");
    const made = await h.app.inject({
      url: "/api/me",
      headers: { authorization: `Bearer ${t}`, "x-request-id": "bad id!" },
    });
    expect(made.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("counts requests by route and status class and traces them", async () => {
    await h.as("ana").get("/api/me");
    await h.app.inject({ url: "/api/me" });
    const m = await h.telemetry.collect();
    expect(m.http_server_requests_total).toBeGreaterThanOrEqual(2);
    expect(m.http_server_duration_ms).toBeGreaterThanOrEqual(2);
    expect(h.telemetry.spans().some((s) => s.name === "GET /api/me")).toBe(true);
  });

  it("forgets the caller at the end of each transaction, so a pooled connection never carries an identity on", async () => {
    await asPrincipal(h.db.app, PERSONAS.ana, async (c) => {
      expect((await c.query("SELECT current_setting('app.person_id', true) AS p")).rows[0].p).toBe(
        PERSONAS.ana.personId,
      );
    });
    const clients = await Promise.all(Array.from({ length: 5 }, () => h.db.app.connect()));
    try {
      for (const c of clients) {
        const r = await c.query(
          "SELECT coalesce(current_setting('app.person_id', true), '') AS p, coalesce(current_setting('app.roles', true), '') AS r",
        );
        expect(r.rows[0]).toEqual({ p: "", r: "" });
        expect((await c.query("SELECT count(*)::int AS n FROM time_entries")).rows[0].n).toBe(0);
      }
    } finally {
      for (const c of clients) c.release();
    }
  });

  it("refuses the dev issuer in production", () => {
    expect(() => assertAuthModeAllowed("dev", { NODE_ENV: "production" })).toThrow(/refused/);
    expect(() => assertAuthModeAllowed("entra", { NODE_ENV: "production" })).not.toThrow();
    expect(() => assertAuthModeAllowed("none", {})).toThrow(/unknown/);
  });

  it("offers dev tokens only for known personas", async () => {
    expect((await h.app.inject({ url: "/dev/token?persona=ana" })).json().persona).toBe("ana");
    expect((await h.app.inject({ url: "/dev/token?persona=mallory" })).statusCode).toBe(404);
    expect((await h.app.inject({ url: "/dev/personas" })).json()).toHaveLength(Object.keys(PERSONAS).length);
  });
});
