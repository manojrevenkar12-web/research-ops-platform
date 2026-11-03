import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DevIssuer } from "@rop/auth";
import { createTestDb, loadFixture, PERSONAS, type TestDb } from "@rop/db";
import { createTelemetry, type Telemetry } from "@rop/observability";
import { ROOT } from "@rop/platform";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildServer } from "../src/server";

export type PersonaKey = keyof typeof PERSONAS;

export interface Harness {
  db: TestDb;
  app: FastifyInstance;
  issuer: DevIssuer;
  telemetry: Telemetry;
  as(who: PersonaKey): Client;
  close(): Promise<void>;
}

export interface Client {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  patch(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
}

/** A server on a fresh database with the fixture loaded. Route hits are written for the handover gate. */
export async function harness(testFile: string, opts: { fixture?: boolean } = {}): Promise<Harness> {
  const db = await createTestDb();
  if (opts.fixture !== false) {
    const c = await db.admin.connect();
    await loadFixture(c).finally(() => c.release());
  }
  const issuer = await DevIssuer.create();
  const telemetry = createTelemetry("test");
  const hits = new Set<string>();
  const app = await buildServer({
    pool: db.app,
    verifier: issuer,
    telemetry,
    devIssuer: issuer,
    onRouteHit: (m, u) => hits.add(`${m} ${u}`),
  });
  const tokens = new Map<string, string>();
  const token = async (who: PersonaKey) => {
    let t = tokens.get(who);
    if (!t) {
      const p = PERSONAS[who];
      t = await issuer.sign({ oid: p.oid, roles: p.roles, name: p.name });
      tokens.set(who, t);
    }
    return t;
  };
  const call = (who: PersonaKey, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    token(who).then((t) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${t}` },
        ...(body === undefined ? {} : { payload: body as object }),
      }),
    );
  return {
    db,
    app,
    issuer,
    telemetry,
    as: (who) => ({
      get: (url) => call(who, "GET", url),
      post: (url, body) => call(who, "POST", url, body ?? {}),
      patch: (url, body) => call(who, "PATCH", url, body ?? {}),
      delete: (url) => call(who, "DELETE", url),
    }),
    async close() {
      const dir = join(ROOT, "reports", "coverage", "routes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${basename(testFile).replace(/\.test\.ts$/, "")}.json`),
        `${JSON.stringify([...hits].sort(), null, 1)}\n`,
      );
      await app.close();
      await telemetry.shutdown();
      await db.drop();
    },
  };
}

/** A date `days` before today, as YYYY-MM-DD. */
export function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
