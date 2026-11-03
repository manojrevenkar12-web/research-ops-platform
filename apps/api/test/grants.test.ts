import { ID, PERSONAS } from "@rop/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { daysAgo, type Harness, harness } from "./helpers";

const WP1 = ID.wp(1); // G1 (EU), Ana leads; Ben and Cleo are members
const WP3 = ID.wp(3); // G2 (DE), Ben leads; Ana, Hana and Gus are members

describe("grant time recording", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(__filename);
  });
  afterAll(async () => h.close());

  it("lists grants with your role and the work packages", async () => {
    const g = (await h.as("hana").get("/api/grants")).json();
    expect(g.map((x: { code: string; my_role: string | null }) => [x.code, x.my_role])).toEqual([
      ["DE-TGT-26", "member"],
      ["EU-LPI-26", null],
    ]);
  });

  it("records, submits, approves: the lead's approval is stamped by the database", async () => {
    const created = await h.as("hana").post("/api/grants/time-entries", {
      work_date: daysAgo(1),
      work_package_id: WP3,
      activity: "Material supplier terms",
      hours: 2.5,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "draft", late: false, grant_id: ID.g2 });
    const id = created.json().id;
    expect((await h.as("hana").post(`/api/grants/time-entries/${id}/submit`)).json().status).toBe(
      "submitted",
    );
    const queue = (await h.as("ben").get("/api/grants/approvals")).json();
    expect(queue.map((e: { id: string }) => e.id)).toContain(id);
    const ok = await h.as("ben").post(`/api/grants/time-entries/${id}/decision`, { decision: "approve" });
    expect(ok.json()).toMatchObject({ status: "approved", approved_by: PERSONAS.ben.personId });
  });

  it("a member who does not lead the grant cannot decide, and a lead cannot approve their own hours", async () => {
    const hana = await h.as("hana").post("/api/grants/time-entries", {
      work_date: daysAgo(1),
      work_package_id: WP3,
      activity: "Review",
      hours: 1,
      submit: true,
    });
    expect(
      (await h.as("ana").post(`/api/grants/time-entries/${hana.json().id}/decision`, { decision: "approve" }))
        .statusCode,
    ).toBe(404);
    // Ben leads G2 and has his own submitted entry there (fixture te(8)).
    expect(
      (await h.as("ben").get("/api/grants/approvals")).json().map((e: { id: string }) => e.id),
    ).not.toContain(ID.te(8));
    expect(
      (await h.as("ben").post(`/api/grants/time-entries/${ID.te(8)}/decision`, { decision: "approve" }))
        .statusCode,
    ).toBe(404);
    // Ana leads G1: she cannot turn her own draft into an approved entry by any route.
    const direct = await h.db.app.connect();
    try {
      await direct.query("BEGIN");
      await direct.query(
        "SELECT set_config('app.person_id', $1, true), set_config('app.roles', 'Staff,Scientist', true)",
        [PERSONAS.ana.personId],
      );
      await expect(
        direct.query("UPDATE time_entries SET status = 'approved' WHERE id = $1", [ID.te(12)]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await direct.query("ROLLBACK");
      direct.release();
    }
  });

  it("a lead can return an entry with a reason, which notifies the person; the person edits and resubmits", async () => {
    const e = await h.as("ana").post("/api/grants/time-entries", {
      work_date: daysAgo(2),
      work_package_id: WP3,
      activity: "Fabrication review",
      hours: 3,
      submit: true,
    });
    const ret = await h.as("ben").post(`/api/grants/time-entries/${e.json().id}/decision`, {
      decision: "return",
      reason: "Please split by work package",
    });
    expect(ret.json().status).toBe("returned");
    const ev = await h.db.admin.query(
      "SELECT payload FROM outbox WHERE topic = 'time.returned' ORDER BY id DESC LIMIT 1",
    );
    expect(ev.rows[0].payload).toMatchObject({
      entry_id: e.json().id,
      reason: "Please split by work package",
    });
    const edited = await h.as("ana").patch(`/api/grants/time-entries/${e.json().id}`, { hours: 2 });
    expect(edited.json().status).toBe("draft");
    expect((await h.as("ana").post(`/api/grants/time-entries/${e.json().id}/submit`)).json().status).toBe(
      "submitted",
    );
  });

  it("a lead can change the status of an entry and nothing else", async () => {
    const c = await h.db.app.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('app.person_id', $1, true), set_config('app.roles', 'Staff,Scientist', true)",
        [PERSONAS.ben.personId],
      );
      await expect(
        c.query("UPDATE time_entries SET status = 'approved', hours = 1 WHERE id = $1", [ID.te(6)]),
      ).rejects.toThrow(/only the person who recorded/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("holds the daily limit, also when entries arrive at the same moment", async () => {
    const day = daysAgo(3);
    const tries = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.as("cleo").post("/api/grants/time-entries", {
          work_date: day,
          work_package_id: WP1,
          activity: "Shots",
          hours: 3,
        }),
      ),
    );
    expect(tries.filter((t) => t.statusCode === 201)).toHaveLength(3);
    expect(tries.filter((t) => t.statusCode === 422)).toHaveLength(2);
    const sum = await h.db.admin.query(
      "SELECT sum(hours)::float AS s FROM time_entries WHERE person_id = $1 AND work_date = $2",
      [PERSONAS.cleo.personId, day],
    );
    expect(sum.rows[0].s).toBe(9);
  });

  it("refuses future dates, quarter-hour violations and grants the person is not on", async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(
      (await h.as("hana").post("/api/grants/time-entries", { work_date: future, activity: "x", hours: 1 }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await h
          .as("hana")
          .post("/api/grants/time-entries", { work_date: daysAgo(1), activity: "x", hours: 1.1 })
      ).statusCode,
    ).toBe(400);
    const notMember = await h.as("dan").post("/api/grants/time-entries", {
      work_date: daysAgo(1),
      work_package_id: WP1,
      activity: "x",
      hours: 1,
    });
    expect(notMember.statusCode).toBe(422);
    expect(notMember.json().detail).toMatch(/grant the person works on/);
  });

  it("marks hours recorded after the window as late", async () => {
    const r = await h.as("hana").post("/api/grants/time-entries", {
      work_date: daysAgo(12),
      work_package_id: WP3,
      activity: "Contract archive",
      hours: 1,
    });
    expect(r.json().late).toBe(true);
  });

  it("nobody can add, change or delete hours in a closed period", async () => {
    const add = await h.as("cleo").post("/api/grants/time-entries", {
      work_date: "2026-09-18",
      work_package_id: WP1,
      activity: "late add",
      hours: 1,
    });
    expect(add.statusCode).toBe(409);
    expect(add.json().detail).toMatch(/2026-09 is closed/);
  });

  it("deletes only drafts", async () => {
    const d = await h
      .as("hana")
      .post("/api/grants/time-entries", { work_date: daysAgo(1), activity: "Internal meeting", hours: 1 });
    expect((await h.as("hana").delete(`/api/grants/time-entries/${d.json().id}`)).statusCode).toBe(204);
    expect((await h.as("ana").delete(`/api/grants/time-entries/${ID.te(6)}`)).statusCode).toBe(404);
  });

  it("shows your own week with the work packages you can book and the recording rules", async () => {
    const t = (await h.as("ana").get("/api/grants/timesheet?from=2026-10-12&to=2026-10-18")).json();
    expect(t.entries.map((e: { id: string }) => e.id).sort()).toEqual([ID.te(6)].sort());
    expect(t.bookable.map((b: { grant_code: string; code: string }) => `${b.grant_code}/${b.code}`)).toEqual([
      "DE-TGT-26/WP1",
      "EU-LPI-26/WP1",
      "EU-LPI-26/WP2",
    ]);
    expect(t.entries.every((e: { person_id: string }) => e.person_id === PERSONAS.ana.personId)).toBe(true);
    expect(t.rules).toEqual({ max_hours_per_day: 10, contemporaneous_days: 7 });
    expect((await h.as("ana").get("/api/grants/timesheet?from=2026-01-01&to=2026-06-30")).statusCode).toBe(
      400,
    );
  });
});

describe("grant costs and reporting", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(`${__filename}-costs`);
  });
  afterAll(async () => h.close());

  it("Finance sees each person's line; another entity's employee is listed, not charged", async () => {
    const r = await h.as("dan").get(`/api/grants/${ID.g1}/cost?period=2026-09`);
    expect(r.statusCode).toBe(200);
    const byPerson = Object.fromEntries(r.json().lines.map((l: { person_id: string }) => [l.person_id, l]));
    expect(byPerson[PERSONAS.ana.personId]).toMatchObject({
      eligible_hours: "6.00",
      rate_unit: "day",
      rate_eur: "455.81",
      direct_eur: "341.86",
    });
    expect(byPerson[PERSONAS.cleo.personId]).toMatchObject({
      other_entity_hours: "8.00",
      direct_eur: "0.00",
    });
    expect(r.json()).toMatchObject({
      contributors: 3,
      direct_eur: "1034.30",
      indirect_eur: "258.58",
      funded_eur: "905.02",
      ineligible_hours: "8.00",
    });
  });

  it("nobody else may ask for personnel costs, and Finance of another entity cannot see this entity's pay", async () => {
    expect((await h.as("ana").get(`/api/grants/${ID.g1}/cost?period=2026-09`)).statusCode).toBe(403);
    expect((await h.as("eva").get(`/api/grants/${ID.g1}/cost?period=2026-09`)).statusCode).toBe(403);
    const us = await h.as("ivo").get(`/api/grants/${ID.g1}/cost?period=2026-09`);
    expect(us.statusCode).toBe(409);
    expect(us.json().type).toMatch(/missing-personnel-cost$/);
  });

  it("refuses to close a month with undecided entries, then closes it and freezes it", async () => {
    const blocked = await h.as("dan").post(`/api/grants/${ID.g2}/periods/2026-10/close`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().undecided).toBe(3);
    for (const id of [ID.te(6)])
      await h.as("ben").post(`/api/grants/time-entries/${id}/decision`, { decision: "approve" });
    await h.as("ana").post(`/api/grants/time-entries/${ID.te(8)}/decision`, { decision: "approve" }); // Ana does not lead G2
    await h.db.admin.query("DELETE FROM time_entries WHERE id = ANY ($1)", [[ID.te(7), ID.te(8)]]);
    const closed = await h.as("dan").post(`/api/grants/${ID.g2}/periods/2026-10/close`);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ period: "2026-10", contributors: 2 });
    const late = await h.as("hana").post("/api/grants/time-entries", {
      work_date: "2026-10-30",
      work_package_id: WP3,
      activity: "x",
      hours: 1,
    });
    expect(late.statusCode).toBe(409);
    expect((await h.as("dan").post(`/api/grants/${ID.g2}/periods/2026-10/close`)).statusCode).toBe(409);
  });

  it("Executive sees a total only when enough people are in it; Finance sees all", async () => {
    const gus = (await h.as("gus").get("/api/grants/reporting")).json();
    const row = (code: string, period: string, rows: { code: string; period: string }[]) =>
      rows.find((r) => r.code === code && r.period === period);
    expect(gus.min_group_size).toBe(3);
    expect(row("EU-LPI-26", "2026-09", gus.rows)).toMatchObject({ withheld: false, contributors: 3 });
    expect(row("DE-TGT-26", "2026-10", gus.rows)).toMatchObject({ withheld: true, direct_eur: null });
    const dan = (await h.as("dan").get("/api/grants/reporting")).json();
    expect(row("DE-TGT-26", "2026-10", dan.rows)).toMatchObject({ withheld: false, contributors: 2 });
    expect((await h.as("hana").get("/api/grants/reporting")).statusCode).toBe(403);
  });
});
