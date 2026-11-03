// One transaction per request, run as the caller. The caller's identity reaches PostgreSQL only through
// transaction-local settings, so row-level security sees it and a pooled connection forgets it at COMMIT.
import { accessModel, type Principal } from "@rop/access";
import { platformConfig } from "@rop/platform";
import pg from "pg";

export type Db = pg.PoolClient;

export interface DbUrls {
  /** Migrations and test setup: the owner of the schema. */
  admin: string;
  /** The runtime role the API and jobs log in as. */
  app: string;
}

export function dbUrls(env: NodeJS.ProcessEnv = process.env): DbUrls {
  const admin = env.ROP_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/rop";
  const app = env.ROP_APP_DATABASE_URL ?? withUser(admin, "rop_app", env.ROP_APP_PASSWORD ?? "rop_app");
  return { admin, app };
}

export function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Scope of Entra ID tokens for Azure Database for PostgreSQL. */
const POSTGRES_TOKEN_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

/**
 * In Azure (ROP_DB_AUTH=entra) there is no database password: each new connection signs in with a fresh
 * token of the runtime's managed identity. Locally and in tests the URL carries the password.
 */
export function createPool(url: string, env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const cfg = platformConfig().database;
  let password: pg.PoolConfig["password"];
  if (env.ROP_DB_AUTH === "entra") {
    let credential: { getToken(scope: string): Promise<{ token: string } | null> } | undefined;
    password = async () => {
      if (!credential) {
        const { ManagedIdentityCredential } = await import("@azure/identity");
        credential = new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID ?? "" });
      }
      const t = await credential.getToken(POSTGRES_TOKEN_SCOPE);
      if (!t) throw new Error("no database token from the managed identity");
      return t.token;
    };
  }
  const pool = new pg.Pool({ connectionString: url, max: cfg.pool_max, ...(password ? { password } : {}) });
  // An idle client can fail (a database restart); the pool replaces it, the process must not crash.
  pool.on("error", () => {});
  return pool;
}

/** Roles from a token that the access model does not know are dropped, never passed to the database. */
export function knownRoles(roles: readonly string[]): string[] {
  const known = new Set(Object.keys(accessModel().roles));
  return [...new Set(roles.filter((r) => known.has(r)))].sort();
}

export async function asPrincipal<T>(
  pool: pg.Pool,
  who: Principal,
  fn: (db: Db) => Promise<T>,
  opts: { readOnly?: boolean } = {},
): Promise<T> {
  const cfg = platformConfig().database;
  const client = await pool.connect();
  try {
    await client.query(opts.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query(
      `SELECT set_config('app.person_id', $1, true), set_config('app.roles', $2, true),
              set_config('app.entity', $3, true), set_config('statement_timeout', $4, true),
              set_config('idle_in_transaction_session_timeout', $5, true)`,
      [
        who.personId,
        knownRoles(who.roles).join(","),
        who.entity,
        String(cfg.statement_timeout_ms),
        String(cfg.idle_in_transaction_timeout_ms),
      ],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL error codes the API maps to HTTP answers. */
export const PG = {
  insufficientPrivilege: "42501",
  checkViolation: "23514",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  notInPrerequisiteState: "55000",
  serializationFailure: "40001",
} as const;

export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
