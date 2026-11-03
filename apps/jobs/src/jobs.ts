// Scheduled jobs, written once and run by any scheduler: Azure Functions timer triggers in production
// (azure.ts), `pnpm job <name>` locally, and directly in tests. Each job acts as a service principal from
// config/access.yaml, so row security limits a job exactly as it limits a person.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeGrantCost, MissingSalaryError, writeSnapshot } from "@rop/costs";
import { asPrincipal, servicePrincipal } from "@rop/db";
import type { Telemetry } from "@rop/observability";
import { ROOT } from "@rop/platform";
import type pg from "pg";
import type { Logger } from "pino";
import { parse } from "yaml";

export interface JobConfig {
  schedule: string;
  principal: string;
  batch_size?: number;
  max_attempts?: number;
}

export function jobsConfig(): Record<string, JobConfig> {
  return (
    parse(readFileSync(join(ROOT, "config", "jobs.yaml"), "utf8")) as { jobs: Record<string, JobConfig> }
  ).jobs;
}

/** Delivers a notification (Microsoft Graph mail in production; a recorder in tests). */
export interface Notifier {
  send(topic: string, payload: Record<string, unknown>): Promise<void>;
}

export interface JobContext {
  pool: pg.Pool;
  telemetry: Telemetry;
  log: Pick<Logger, "info" | "warn" | "error">;
  now: Date;
  notifier: Notifier;
}

export interface JobResult {
  job: string;
  outcome: "succeeded" | "failed";
  details: Record<string, unknown>;
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
function monthsBetween(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p >= toExclusive) return out;
    out.push(p);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
}

/** Refresh the figures of every open month that has ended, for the grants of the job's own entity. */
export async function costSnapshot(ctx: JobContext): Promise<JobResult> {
  const who = servicePrincipal(jobsConfig()["cost-snapshot"]!.principal);
  const current = monthOf(ctx.now);
  const grants = await asPrincipal(
    ctx.pool,
    who,
    async (c) =>
      (
        await c.query(
          "SELECT id, code, to_char(starts_on, 'YYYY-MM') AS first, to_char(ends_on, 'YYYY-MM') AS last FROM grants WHERE entity = $1 ORDER BY code",
          [who.entity],
        )
      ).rows,
  );
  const written: string[] = [];
  const failures: { grant: string; period: string; reason: string }[] = [];
  for (const g of grants) {
    const ended = monthsBetween(g.first, current).filter((p) => p <= g.last);
    for (const period of ended) {
      try {
        // One transaction per month: a failure leaves the other months' figures in place.
        const done = await asPrincipal(ctx.pool, who, async (c) => {
          const cp = await c.query("SELECT status FROM cost_periods WHERE grant_id = $1 AND period = $2", [
            g.id,
            period,
          ]);
          if (cp.rows[0]?.status === "closed") return false;
          const any = await c.query(
            "SELECT 1 FROM time_entries WHERE grant_id = $1 AND to_char(work_date, 'YYYY-MM') <= $2 AND extract(year FROM work_date) = $3 LIMIT 1",
            [g.id, period, Number(period.slice(0, 4))],
          );
          if (!any.rowCount && !cp.rowCount) return false;
          await c.query(
            "INSERT INTO cost_periods (grant_id, period) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [g.id, period],
          );
          await writeSnapshot(c, await computeGrantCost(c, g.id, period));
          return true;
        });
        if (done) written.push(`${g.code}/${period}`);
      } catch (err) {
        const reason = err instanceof MissingSalaryError ? err.message : (err as Error).message;
        failures.push({ grant: g.code, period, reason });
        ctx.log.error({ grant: g.code, period, reason }, "cost snapshot failed");
      }
    }
  }
  const outcome = failures.length ? "failed" : "succeeded";
  ctx.telemetry.counter("job_runs_total", 1, { job: "cost-snapshot", outcome });
  return { job: "cost-snapshot", outcome, details: { written, failures } };
}

/** Queue a reminder for everyone with unsubmitted hours older than the recording window. */
export async function reminders(ctx: JobContext): Promise<JobResult> {
  const who = servicePrincipal(jobsConfig().reminders!.principal);
  const queued = await asPrincipal(ctx.pool, who, async (c) => {
    const rows = (
      await c.query(
        "SELECT person_id, entries, to_char(oldest, 'YYYY-MM-DD') AS oldest FROM app.unsubmitted_summary()",
      )
    ).rows;
    for (const r of rows) {
      await c.query("INSERT INTO outbox (topic, payload) VALUES ('time.reminder', $1)", [JSON.stringify(r)]);
    }
    return rows;
  });
  const total = queued.reduce((s: number, r: { entries: number }) => s + r.entries, 0);
  ctx.telemetry.gauge("grants_unsubmitted_entries", total);
  ctx.telemetry.counter("job_runs_total", 1, { job: "reminders", outcome: "succeeded" });
  return { job: "reminders", outcome: "succeeded", details: { people: queued.length, entries: total } };
}

/**
 * Deliver queued notifications at least once. Rows are locked with SKIP LOCKED, so two dispatchers never
 * take the same row; a failed delivery is retried on later runs until max_attempts, then left for a person.
 */
export async function dispatcher(ctx: JobContext): Promise<JobResult> {
  const cfg = jobsConfig().dispatcher!;
  const who = servicePrincipal(cfg.principal);
  const max = cfg.max_attempts ?? 5;
  let sent = 0;
  let failed = 0;
  await asPrincipal(ctx.pool, who, async (c) => {
    const batch = await c.query(
      `SELECT id, topic, payload FROM outbox WHERE dispatched_at IS NULL AND attempts < $1
        ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [max, cfg.batch_size ?? 50],
    );
    for (const m of batch.rows) {
      try {
        await ctx.notifier.send(m.topic, m.payload);
        await c.query(
          "UPDATE outbox SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1",
          [m.id],
        );
        sent++;
      } catch (err) {
        await c.query("UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1", [
          m.id,
          (err as Error).message.slice(0, 500),
        ]);
        failed++;
      }
    }
  });
  const outcome = failed ? "failed" : "succeeded";
  ctx.telemetry.counter("job_runs_total", 1, { job: "dispatcher", outcome });
  return { job: "dispatcher", outcome, details: { sent, failed } };
}

export const JOBS = { "cost-snapshot": costSnapshot, reminders, dispatcher } as const;
export type JobName = keyof typeof JOBS;
