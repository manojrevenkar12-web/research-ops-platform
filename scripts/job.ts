// pnpm job <cost-snapshot|reminders|dispatcher>: run a scheduled job once against the local database.
import { createPool, dbUrls } from "@rop/db";
import { createLogger, createTelemetry } from "@rop/observability";
import { JOBS, type JobName } from "../apps/jobs/src/jobs";

const name = process.argv[2] as JobName;
const job = JOBS[name];
if (!job) {
  console.error(`usage: pnpm job <${Object.keys(JOBS).join("|")}>`);
  process.exit(2);
}
const pool = createPool(dbUrls().app);
const telemetry = createTelemetry("jobs-cli");
const log = createLogger(`job:${name}`);
const notifier = {
  async send(topic: string, payload: Record<string, unknown>) {
    log.info({ topic, payload }, "would send");
  },
};
try {
  const r = await job({ pool, telemetry, log, now: new Date(), notifier });
  console.log(JSON.stringify(r, null, 2));
  if (r.outcome === "failed") process.exitCode = 1;
} finally {
  await pool.end();
  await telemetry.shutdown();
}
