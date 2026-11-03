import { computeGrantCost } from "@rop/costs";
import { asPrincipal, createTestDb, ID, loadFixture, PERSONAS, servicePrincipal, type TestDb } from "@rop/db";
import { createTelemetry } from "@rop/observability";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { costSnapshot, dispatcher, type JobContext, type Notifier, reminders } from "../src/jobs";

const quiet = { info() {}, warn() {}, error() {} };
const NOW = new Date("2026-11-03T02:30:00Z");

describe("scheduled jobs", () => {
  let db: TestDb;
  let telemetry: ReturnType<typeof createTelemetry>;
  const sent: { topic: string; payload: Record<string, unknown> }[] = [];
  const recorder: Notifier = {
    async send(topic, payload) {
      sent.push({ topic, payload });
    },
  };
  const ctx = (over: Partial<JobContext> = {}): JobContext => ({
    pool: db.app,
    telemetry,
    log: quiet,
    now: NOW,
    notifier: recorder,
    ...over,
  });

  beforeEach(async () => {
    db = await createTestDb();
    const c = await db.admin.connect();
    await loadFixture(c).finally(() => c.release());
    telemetry = createTelemetry("jobs-test");
    sent.length = 0;
  });
  afterEach(async () => {
    await telemetry.shutdown();
    await db.drop();
  });
  afterAll(() => {});

  it("refreshes every open month that has ended and leaves closed months alone", async () => {
    const before = await db.admin.query(
      "SELECT funded_eur FROM grant_cost_snapshots WHERE grant_id = $1 AND period = '2026-09'",
      [ID.g1],
    );
    const r = await costSnapshot(ctx());
    expect(r.outcome).toBe("succeeded");
    expect(r.details.written).toEqual(["DE-TGT-26/2026-10", "EU-LPI-26/2026-10"]);
    const after = await db.admin.query(
      "SELECT funded_eur FROM grant_cost_snapshots WHERE grant_id = $1 AND period = '2026-09'",
      [ID.g1],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("writes the same figures Finance sees in the API", async () => {
    await costSnapshot(ctx());
    const snap = await db.admin.query(
      "SELECT direct_eur, funded_eur, contributors FROM grant_cost_snapshots WHERE grant_id = $1 AND period = '2026-10'",
      [ID.g2],
    );
    const live = await asPrincipal(db.app, PERSONAS.dan, (c) => computeGrantCost(c, ID.g2, "2026-10"));
    expect(snap.rows[0]).toEqual({
      direct_eur: live.direct_eur,
      funded_eur: live.funded_eur,
      contributors: live.contributors,
    });
  });

  it("reports a failed grant month without stopping the others, and counts the failure for the alert", async () => {
    await db.admin.query("DELETE FROM salary_costs WHERE person_id = $1", [PERSONAS.jan.personId]);
    const r = await costSnapshot(ctx());
    expect(r.outcome).toBe("failed");
    expect(r.details.written).toEqual(["DE-TGT-26/2026-10"]);
    expect((r.details.failures as { grant: string }[]).map((f) => f.grant)).toEqual(["EU-LPI-26"]);
    expect((await telemetry.collect()).job_runs_total).toBe(1);
  });

  it("queues reminders from a summary that reveals counts, never hours", async () => {
    const r = await reminders(ctx());
    expect(r.details).toMatchObject({ people: 4 });
    const q = await db.admin.query(
      "SELECT payload FROM outbox WHERE topic = 'time.reminder' AND id > 1000 ORDER BY id",
    );
    expect(Object.keys(q.rows[0].payload).sort()).toEqual(["entries", "oldest", "person_id"]);
    // The reminder identity cannot read the entries themselves.
    const visible = await asPrincipal(
      db.app,
      servicePrincipal("reminders"),
      async (c) => (await c.query("SELECT count(*)::int AS n FROM time_entries")).rows[0].n,
    );
    expect(visible).toBe(0);
    await expect(
      asPrincipal(db.app, PERSONAS.dan, (c) => c.query("SELECT * FROM app.unsubmitted_summary()")),
    ).rejects.toThrow(/only platform services/);
  });

  it("delivers queued messages once, even with two dispatchers running at the same time", async () => {
    for (let i = 0; i < 30; i++)
      await db.admin.query("INSERT INTO outbox (topic, payload) VALUES ('test', $1)", [
        JSON.stringify({ i }),
      ]);
    const slow: Notifier = {
      async send(topic, payload) {
        await new Promise((r) => setTimeout(r, 2));
        sent.push({ topic, payload });
      },
    };
    const [a, b] = await Promise.all([
      dispatcher(ctx({ notifier: slow })),
      dispatcher(ctx({ notifier: slow })),
    ]);
    const total = (a.details.sent as number) + (b.details.sent as number);
    expect(total).toBe(31); // 30 new plus the fixture's one
    const ids = sent.map((s) => JSON.stringify(s.payload));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("retries a failed delivery on later runs and gives up after the configured attempts", async () => {
    const broken: Notifier = {
      async send() {
        throw new Error("Graph returned 503");
      },
    };
    for (let i = 0; i < 6; i++) await dispatcher(ctx({ notifier: broken }));
    const row = await db.admin.query("SELECT attempts, last_error, dispatched_at FROM outbox WHERE id = 1");
    expect(row.rows[0]).toEqual({ attempts: 5, last_error: "Graph returned 503", dispatched_at: null });
    const r = await dispatcher(ctx());
    expect(r.details).toEqual({ sent: 0, failed: 0 });
  });
});
