import { assertAuthModeAllowed, DevIssuer, entraVerifier, type Verifier } from "@rop/auth";
import { createPool, dbUrls } from "@rop/db";
import { createLogger, createTelemetry } from "@rop/observability";
import { platformConfig } from "@rop/platform";
import { buildServer } from "./server";

const mode = process.env.AUTH_MODE ?? "entra";
assertAuthModeAllowed(mode);
const logger = createLogger("api");
const telemetry = createTelemetry();
const pool = createPool(dbUrls().app);
const devIssuer = mode === "dev" ? await DevIssuer.create() : undefined;
const verifier: Verifier = devIssuer ?? entraVerifier();
const app = await buildServer({ pool, verifier, telemetry, logger, ...(devIssuer ? { devIssuer } : {}) });
const port = Number(process.env.PORT ?? platformConfig().api.port);
await app.listen({ port, host: "0.0.0.0" });
logger.info({ port, mode }, "api listening");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await pool.end();
    await telemetry.shutdown();
    process.exit(0);
  });
}
