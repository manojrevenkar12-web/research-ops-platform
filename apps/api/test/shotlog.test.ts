import { ID } from "@rop/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, harness } from "./helpers";

const codes = (rows: { code: string }[]) => rows.map((r) => r.code).sort();

describe("shot log", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(__filename);
  });
  afterAll(async () => h.close());

  describe("what each person sees", () => {
    it("a scientist without clearance sees no restricted campaign, not even one they once led", async () => {
      const ben = (await h.as("ben").get("/api/shotlog/campaigns")).json();
      expect(codes(ben)).toEqual(["AUS-26-T1", "PHX-25-I9", "PHX-26-I2"]);
      const ana = (await h.as("ana").get("/api/shotlog/campaigns")).json();
      expect(codes(ana)).toEqual(["AUS-26-T1", "PHX-25-I9", "PHX-25-R3", "PHX-26-I2", "PHX-26-R1"]);
    });

    it("someone who left the lab still sees the campaign they led, and nothing else", async () => {
      expect(codes((await h.as("hana").get("/api/shotlog/campaigns")).json())).toEqual(["PHX-25-I9"]);
      expect(codes((await h.as("dan").get("/api/shotlog/campaigns")).json())).toEqual([]);
    });

    it("answers 404, not 403, for a campaign you may not see, so its existence is not confirmed", async () => {
      const r = await h.as("ben").get(`/api/shotlog/campaigns/${ID.c1}`);
      expect(r.statusCode).toBe(404);
      expect((await h.as("ben").get(`/api/shotlog/campaigns/${ID.c1}/shots`)).statusCode).toBe(404);
      expect((await h.as("ana").get(`/api/shotlog/campaigns/${ID.c1}`)).json().members).toHaveLength(3);
    });

    it("search only finds what you may read: restricted notes never appear in results", async () => {
      const ana = (await h.as("ana").get("/api/shotlog/search?q=interlock")).json();
      expect(ana.length).toBeGreaterThanOrEqual(2);
      expect(ana[0].snippet).toMatch(/<b>[Ii]nterlock<\/b>/);
      expect((await h.as("ben").get("/api/shotlog/search?q=interlock")).json()).toEqual([]);
      const both = (await h.as("ben").get("/api/shotlog/search?q=alignment")).json();
      expect(both.map((r: { campaign_code: string }) => r.campaign_code)).toEqual(["PHX-26-I2", "PHX-26-I2"]);
    });

    it("rejects a search that is too short", async () => {
      expect((await h.as("ana").get("/api/shotlog/search?q=a")).statusCode).toBe(400);
    });
  });

  describe("logging shots", () => {
    it("numbers shots in order, and two operators logging at once never get the same number", async () => {
      const shots = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          h.as(i % 2 ? "ana" : "ben").post(`/api/shotlog/campaigns/${ID.c2}/shots`, {
            fired_at: "2026-11-02T10:00:00Z",
            outcome: "nominal",
            notes: `burst ${i}`,
          }),
        ),
      );
      expect(shots.map((s) => s.statusCode)).toEqual(Array(8).fill(201));
      expect(shots.map((s) => s.json().shot_no).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("a restricted campaign's shot is restricted without anyone having to remember", async () => {
      const r = await h.as("cleo").post(`/api/shotlog/campaigns/${ID.c1}/shots`, {
        fired_at: "2026-11-02T09:00:00Z",
        outcome: "partial",
        notes: "Half energy.",
      });
      expect(r.statusCode).toBe(201);
      const row = await h.db.admin.query("SELECT classification FROM shots WHERE id = $1", [r.json().id]);
      expect(row.rows[0].classification).toBe("restricted");
    });

    it("an observer cannot log shots; someone who cannot see the campaign gets 404", async () => {
      expect(
        (
          await h.as("ben").post(`/api/shotlog/campaigns/${ID.c2}/members`, {
            person_id: "00000000-0000-4000-8000-000100000003",
            role: "observer",
          })
        ).statusCode,
      ).toBe(201);
      const asObserver = await h.as("cleo").post(`/api/shotlog/campaigns/${ID.c2}/shots`, {
        fired_at: "2026-11-02T09:00:00Z",
        outcome: "nominal",
      });
      expect(asObserver.statusCode).toBe(403);
      const hidden = await h.as("ben").post(`/api/shotlog/campaigns/${ID.c1}/shots`, {
        fired_at: "2026-11-02T09:00:00Z",
        outcome: "nominal",
      });
      expect(hidden.statusCode).toBe(404);
    });

    it("only a campaign's lead adds members", async () => {
      const r = await h.as("ana").post(`/api/shotlog/campaigns/${ID.c2}/members`, {
        person_id: "00000000-0000-4000-8000-000100000008",
        role: "observer",
      });
      expect(r.statusCode).toBe(403);
    });

    it("a shot uses up its target, which can then never be shot again", async () => {
      const first = await h.as("ben").post(`/api/shotlog/campaigns/${ID.c2}/shots`, {
        fired_at: "2026-11-02T11:00:00Z",
        target_id: ID.t(3),
        outcome: "nominal",
      });
      expect(first.statusCode).toBe(201);
      const t = (await h.as("ben").get("/api/shotlog/targets?status=shot")).json();
      expect(t.map((x: { serial: string }) => x.serial)).toContain("TGT-0003");
      const again = await h.as("ben").post(`/api/shotlog/campaigns/${ID.c2}/shots`, {
        fired_at: "2026-11-02T11:05:00Z",
        target_id: ID.t(3),
        outcome: "nominal",
      });
      expect(again.statusCode).toBe(422);
      const elsewhere = await h.as("cleo").post(`/api/shotlog/campaigns/${ID.c3}/shots`, {
        fired_at: "2026-11-02T11:05:00Z",
        target_id: ID.t(2),
        outcome: "nominal",
      });
      expect(elsewhere.statusCode).toBe(422);
    });

    it("a correction keeps the original and shows as the latest version", async () => {
      const r = await h.as("ana").post(`/api/shotlog/shots/${ID.shot(5)}/corrections`, {
        outcome: "nominal",
        energy_j: 3.0,
        notes: "Trigger jitter was in the camera, not the diagnostic.",
        reason: "camera timestamp checked against the trigger log",
      });
      expect(r.statusCode).toBe(201);
      const list = (await h.as("ben").get(`/api/shotlog/campaigns/${ID.c2}/shots?limit=100`)).json();
      const two = list.find((s: { shot_no: number }) => s.shot_no === 2);
      expect(two).toMatchObject({ outcome: "nominal", corrections: 1, corrected_by: r.json().id });
      const original = await h.db.admin.query("SELECT outcome FROM shots WHERE id = $1", [ID.shot(5)]);
      expect(original.rows[0].outcome).toBe("partial");
    });

    it("validates shot input", async () => {
      const bad = await h
        .as("ben")
        .post(`/api/shotlog/campaigns/${ID.c2}/shots`, { fired_at: "yesterday", outcome: "great" });
      expect(bad.statusCode).toBe(400);
      expect(
        bad
          .json()
          .errors.map((e: { path: string }) => e.path)
          .sort(),
      ).toEqual(["fired_at", "outcome"]);
    });
  });

  describe("campaigns and targets", () => {
    it("a scientist creates a campaign and leads it; clearance is needed for a restricted one", async () => {
      const ok = await h.as("ben").post("/api/shotlog/campaigns", {
        code: "PHX-26-I7",
        title: "Beam pointing drift",
        facility: "Darmstadt lab",
        entity: "DE",
        classification: "internal",
        starts_on: "2026-11-10",
      });
      expect(ok.statusCode).toBe(201);
      const detail = (await h.as("ben").get(`/api/shotlog/campaigns/${ok.json().id}`)).json();
      expect(detail.members).toEqual([expect.objectContaining({ role: "lead", display_name: "Ben Okafor" })]);
      const restricted = await h.as("ben").post("/api/shotlog/campaigns", {
        code: "PHX-26-R8",
        title: "x x x",
        facility: "Lab",
        entity: "DE",
        classification: "restricted",
        starts_on: "2026-11-10",
      });
      expect(restricted.statusCode).toBe(403);
      const notScientist = await h.as("hana").post("/api/shotlog/campaigns", {
        code: "PHX-26-I9",
        title: "x x x",
        facility: "Lab",
        entity: "DE",
        classification: "internal",
        starts_on: "2026-11-10",
      });
      expect(notScientist.statusCode).toBe(403);
    });

    it("registers fabricated targets and moves them through their life", async () => {
      const made = await h.as("cleo").post("/api/shotlog/targets", {
        batch: "B-1102",
        design: "CH foil 10 µm",
        serials: ["TGT-1001", "TGT-1002"],
      });
      expect(made.statusCode).toBe(201);
      const [a, b] = made.json();
      expect(
        (
          await h.as("cleo").post(`/api/shotlog/targets/${a.id}/transition`, {
            to: "characterized",
            characterization: { thickness_um: 10.2 },
          })
        ).json().status,
      ).toBe("characterized");
      const alloc = await h
        .as("cleo")
        .post(`/api/shotlog/targets/${a.id}/transition`, { to: "allocated", campaign_id: ID.c3 });
      expect(alloc.json()).toMatchObject({ status: "allocated", campaign_id: ID.c3 });
      const skip = await h
        .as("cleo")
        .post(`/api/shotlog/targets/${b.id}/transition`, { to: "allocated", campaign_id: ID.c3 });
      expect(skip.statusCode).toBe(422);
      const events = await h.db.admin.query(
        "SELECT to_status FROM target_events WHERE target_id = $1 ORDER BY id",
        [a.id],
      );
      expect(events.rows.map((e) => e.to_status)).toEqual(["fabricated", "characterized", "allocated"]);
      const dead = await h
        .as("cleo")
        .post(`/api/shotlog/targets/${ID.t(6)}/transition`, { to: "characterized" });
      expect(dead.statusCode).toBe(422);
      const noCampaign = await h
        .as("cleo")
        .post(`/api/shotlog/targets/${ID.t(4)}/transition`, { to: "allocated" });
      expect(noCampaign.statusCode).toBe(400);
    });

    it("everyone can read the inventory, only scientists change it", async () => {
      expect((await h.as("hana").get("/api/shotlog/targets")).json().length).toBeGreaterThanOrEqual(8);
      expect(
        (await h.as("hana").post(`/api/shotlog/targets/${ID.t(4)}/transition`, { to: "scrapped" }))
          .statusCode,
      ).toBe(404);
      expect(
        (await h.as("hana").post("/api/shotlog/targets", { batch: "B", design: "D", serials: ["TGT-9999"] }))
          .statusCode,
      ).toBe(403);
    });
  });
});
