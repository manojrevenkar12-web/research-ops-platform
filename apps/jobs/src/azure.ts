// Azure Functions entry point (Node.js programming model v4). Each job becomes a timer trigger with the
// schedule from config/jobs.yaml; the Function App runs with a managed identity that maps to the job's
// database role (see infra/functions.tf).
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { createPool, dbUrls } from "@rop/db";
import { createTelemetry } from "@rop/observability";
import { JOBS, type JobName, jobsConfig, type Notifier } from "./jobs";

const pool = createPool(dbUrls().app);
const telemetry = createTelemetry("research-ops-jobs");

/** Production delivery goes through Microsoft Graph sendMail; it is outside this repository's tests. */
const notifier: Notifier = {
  async send(topic, payload) {
    throw new Error(
      `Graph mail delivery is not configured (topic ${topic}, ${Object.keys(payload).length} fields)`,
    );
  },
};

for (const [name, cfg] of Object.entries(jobsConfig())) {
  const job = JOBS[name as JobName];
  if (!job) throw new Error(`config/jobs.yaml names unknown job ${name}`);
  app.timer(name, {
    schedule: cfg.schedule,
    runOnStartup: false,
    handler: async (_timer: Timer, context: InvocationContext) => {
      const log = { info: context.log, warn: context.warn, error: context.error } as never;
      const result = await job({ pool, telemetry, log, now: new Date(), notifier });
      context.log(JSON.stringify(result));
      if (result.outcome === "failed") throw new Error(`${name} failed: ${JSON.stringify(result.details)}`);
    },
  });
}
