// Route declaration for every app on the platform. A route states its app, its summary and its schemas;
// the registry feeds the OpenAPI document and the handover gate's route coverage, and every handler runs
// its database work as the signed-in person inside one transaction.
import type { Principal } from "@rop/access";
import { asPrincipal, type Db, PG, pgCode } from "@rop/db";
import type { Telemetry } from "@rop/observability";
import { AppError } from "@rop/platform";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { ZodError, type z } from "zod";

export type AppName = "platform" | "shotlog" | "grants";

export interface Ctx<P, Q, B> {
  principal: Principal;
  params: P;
  query: Q;
  body: B;
  req: FastifyRequest;
  reply: FastifyReply;
  /** Run database work as the caller, in one transaction. */
  db<T>(fn: (db: Db) => Promise<T>, opts?: { readOnly?: boolean }): Promise<T>;
  telemetry: Telemetry;
}

export interface RouteDef<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  app: AppName;
  summary: string;
  /** A coarse role check before any query; row security remains the real gate. */
  roles?: string[];
  params?: P;
  query?: Q;
  body?: B;
  status?: number;
  handler(ctx: Ctx<z.infer<P>, z.infer<Q>, z.infer<B>>): Promise<unknown>;
}

export interface RegisteredRoute {
  method: string;
  url: string;
  app: AppName;
  summary: string;
  roles?: string[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  status: number;
}

export interface Deps {
  pool: pg.Pool;
  telemetry: Telemetry;
}

export const registry: RegisteredRoute[] = [];

export function route<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType>(
  app: FastifyInstance,
  deps: Deps,
  def: RouteDef<P, Q, B>,
): void {
  const id = `${def.method} ${def.url}`;
  if (!registry.some((r) => `${r.method} ${r.url}` === id)) {
    registry.push({
      method: def.method,
      url: def.url,
      app: def.app,
      summary: def.summary,
      status: def.status ?? 200,
      ...(def.roles ? { roles: def.roles } : {}),
      ...(def.params ? { params: def.params } : {}),
      ...(def.query ? { query: def.query } : {}),
      ...(def.body ? { body: def.body } : {}),
    });
  }
  app.route({
    method: def.method,
    url: def.url,
    handler: async (req, reply) => {
      const principal = req.principal;
      if (!principal) throw new AppError(401, "unauthenticated", "Sign in first.");
      if (def.roles && !def.roles.some((r) => principal.roles.includes(r))) {
        deps.telemetry.counter("access_denied_total", 1, { reason: "role", route: def.url });
        throw new AppError(403, "forbidden", `This needs one of the roles: ${def.roles.join(", ")}.`);
      }
      const params = def.params ? def.params.parse(req.params) : undefined;
      const query = def.query ? def.query.parse(req.query) : undefined;
      const body = def.body ? def.body.parse(req.body ?? {}) : undefined;
      const span = deps.telemetry.tracer.startSpan(`db ${id}`);
      try {
        const result = await def.handler({
          principal,
          params: params as z.infer<P>,
          query: query as z.infer<Q>,
          body: body as z.infer<B>,
          req,
          reply,
          telemetry: deps.telemetry,
          db: (fn, opts) => asPrincipal(deps.pool, principal, fn, opts),
        });
        reply.status(def.status ?? 200);
        return result ?? (def.status === 204 ? undefined : {});
      } finally {
        span.end();
      }
    },
  });
}

const PROBLEM_BASE = "https://research-ops-platform.example/problems/";

/** Map any error to RFC 9457 problem+json. Database refusals become plain answers, not 500s. */
export function toProblem(err: unknown, instance: string): { status: number; body: Record<string, unknown> } {
  const problem = (
    status: number,
    type: string,
    title: string,
    detail?: string,
    extra?: Record<string, unknown>,
  ) => ({
    status,
    body: {
      type: PROBLEM_BASE + type,
      title,
      status,
      ...(detail ? { detail } : {}),
      instance,
      ...(extra ?? {}),
    },
  });
  if (err instanceof AppError) return problem(err.status, err.type, err.message, undefined, err.detail);
  if (err instanceof ZodError) {
    return problem(400, "invalid-request", "The request is not valid.", undefined, {
      errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const fastifyErr = err as { statusCode?: number; validation?: unknown; code?: string; message?: string };
  if (
    fastifyErr.statusCode &&
    fastifyErr.statusCode >= 400 &&
    fastifyErr.statusCode < 500 &&
    !pgCode(err)?.match(/^\d{5}$/)
  ) {
    return problem(fastifyErr.statusCode, "invalid-request", fastifyErr.message ?? "Bad request.");
  }
  const message = (err as Error)?.message ?? "";
  switch (pgCode(err)) {
    case PG.insufficientPrivilege:
      return problem(403, "forbidden", "You are not allowed to do that.", message);
    case PG.checkViolation:
      return problem(422, "rule-violated", "That breaks a rule of the record.", message);
    case PG.uniqueViolation:
      return problem(409, "already-exists", "That already exists.", message);
    case PG.foreignKeyViolation:
      return problem(422, "unknown-reference", "That refers to something that does not exist.", message);
    case PG.notInPrerequisiteState:
      return problem(409, "not-allowed-now", "That cannot change any more.", message);
    case "57014":
      return problem(503, "timeout", "The database took too long; try again.");
    default:
      return problem(500, "internal", "Something went wrong on our side. The request id helps us find it.");
  }
}

export function notFound(what: string): AppError {
  return new AppError(404, "not-found", `${what} not found, or you cannot see it.`);
}
