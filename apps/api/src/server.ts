import { randomUUID } from "node:crypto";
import type { Principal } from "@rop/access";
import { type AuthError, bearer, type DevIssuer, type Verifier } from "@rop/auth";
import { asPrincipal, knownRoles, PERSONAS } from "@rop/db";
import type { Telemetry } from "@rop/observability";
import { AppError, platformConfig } from "@rop/platform";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type pg from "pg";
import type { Logger } from "pino";
import { grantsRoutes } from "./features/grants";
import { platformRoutes } from "./features/platform";
import { shotlogRoutes } from "./features/shotlog";
import { toProblem } from "./http";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
    startedAt: bigint;
  }
}

export interface ServerOptions {
  pool: pg.Pool;
  verifier: Verifier;
  telemetry: Telemetry;
  logger?: Logger | false;
  /** Only in development and tests: issues tokens for the fixture personas. */
  devIssuer?: DevIssuer;
  /** Records which routes were called (tests feed the handover gate's route coverage with it). */
  onRouteHit?: (method: string, url: string) => void;
}

/** Resolve the token to a person. Platform is a service-only role: a person's token can never carry it. */
async function principalFor(
  pool: pg.Pool,
  verifier: Verifier,
  header: string | undefined,
): Promise<Principal> {
  let claims: Awaited<ReturnType<Verifier["verify"]>>;
  try {
    claims = await verifier.verify(bearer(header));
  } catch (err) {
    throw new AppError(401, "unauthenticated", (err as AuthError).message);
  }
  if (claims.idtyp === "app")
    throw new AppError(403, "forbidden", "Application tokens are not accepted by this API.");
  const roles = knownRoles(claims.roles).filter((r) => r !== "Platform");
  const lookup: Principal = { personId: "", roles, entity: "" };
  const person = await asPrincipal(
    pool,
    lookup,
    async (c) =>
      (
        await c.query("SELECT id, entity, active, display_name FROM people WHERE entra_oid = $1", [
          claims.oid,
        ])
      ).rows[0],
    { readOnly: true },
  );
  if (!person || !person.active)
    throw new AppError(403, "not-provisioned", "Your account is not set up for this platform.");
  return { personId: person.id, roles, entity: person.entity, label: person.display_name };
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const cfg = platformConfig();
  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger as unknown as FastifyBaseLogger } : { logger: false }),
    bodyLimit: cfg.api.body_limit_bytes,
    requestTimeout: cfg.api.request_timeout_ms,
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && /^[A-Za-z0-9-]{8,64}$/.test(given) ? given : randomUUID();
    },
  });
  const deps = { pool: opts.pool, telemetry: opts.telemetry };

  app.addHook("onRequest", async (req, reply) => {
    req.startedAt = process.hrtime.bigint();
    reply.header("x-request-id", req.id);
    reply.header("cache-control", "no-store");
    if (req.url.startsWith("/api/"))
      req.principal = await principalFor(opts.pool, opts.verifier, req.headers.authorization);
  });

  app.addHook("onResponse", async (req, reply) => {
    const ms = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    const routeUrl = req.routeOptions.url ?? "unmatched";
    const attrs = {
      route: routeUrl,
      method: req.method,
      status_class: `${Math.floor(reply.statusCode / 100)}xx`,
    };
    opts.telemetry.counter("http_server_requests_total", 1, attrs);
    opts.telemetry.histogram("http_server_duration_ms", ms, attrs);
    const span = opts.telemetry.tracer.startSpan(`${req.method} ${routeUrl}`, {
      attributes: {
        "http.route": routeUrl,
        "http.response.status_code": reply.statusCode,
        "request.id": req.id,
      },
    });
    span.end();
    if (ms > cfg.observability.slow_request_ms) req.log.warn({ ms, route: routeUrl }, "slow request");
    if (req.routeOptions.url) opts.onRouteHit?.(req.method, req.routeOptions.url);
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toProblem(err, req.id);
    if (status >= 500) req.log.error({ err }, "request failed");
    if (status === 403)
      opts.telemetry.counter("access_denied_total", 1, {
        reason: "policy",
        route: req.routeOptions.url ?? "",
      });
    reply.status(status).type("application/problem+json").send(body);
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await opts.pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "database unavailable" });
    }
  });

  if (opts.devIssuer) {
    const dev = opts.devIssuer;
    app.get("/dev/personas", async () =>
      Object.values(PERSONAS).map((p) => ({
        key: p.key,
        name: p.name,
        team: p.team,
        entity: p.entity,
        roles: p.roles,
      })),
    );
    app.get<{ Querystring: { persona?: string } }>("/dev/token", async (req) => {
      const p = PERSONAS[req.query.persona as keyof typeof PERSONAS];
      if (!p) throw new AppError(404, "not-found", "No such persona.");
      return { token: await dev.sign({ oid: p.oid, roles: p.roles, name: p.name }), persona: p.key };
    });
  }

  platformRoutes(app, deps);
  shotlogRoutes(app, deps);
  grantsRoutes(app, deps);
  return app;
}
