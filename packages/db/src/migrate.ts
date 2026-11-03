// Migrations with a down step for every up step. After each run the runner copies settings from config and
// regenerates the row-level security policies from config/access.yaml for the tables that exist.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AccessModel, accessModel, policiesSql } from "@rop/access";
import { grantsConfig, platformConfig, ROOT } from "@rop/platform";
import type pg from "pg";

export const MIGRATIONS = join(ROOT, "packages", "db", "migrations");

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export function migrations(): Migration[] {
  const files = readdirSync(MIGRATIONS);
  const ups = files.filter((f) => f.endsWith(".up.sql")).sort();
  return ups.map((f) => {
    const m = /^(\d{4})_(.+)\.up\.sql$/.exec(f);
    if (!m) throw new Error(`bad migration file name ${f}`);
    const down = f.replace(".up.sql", ".down.sql");
    if (!files.includes(down)) throw new Error(`${f} has no down migration`);
    return {
      version: Number(m[1]),
      name: m[2]!,
      up: readFileSync(join(MIGRATIONS, f), "utf8"),
      down: readFileSync(join(MIGRATIONS, down), "utf8"),
    };
  });
}

/** The settings the database reads, copied from config (config stays the single source). */
export function settingsFromConfig(): Record<string, number | boolean | string> {
  const g = grantsConfig();
  return {
    max_hours_per_day: g.time_recording.max_hours_per_day,
    contemporaneous_days: g.time_recording.contemporaneous_days,
    min_group_size: g.reporting.min_group_size,
  };
}

export async function ensureRuntimeRole(admin: pg.ClientBase, password: string): Promise<void> {
  const role = platformConfig().database.runtime_role;
  const pw = password.replaceAll("'", "''");
  const attrs = `LOGIN PASSWORD '${pw}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`;
  // Test files create databases in parallel; two of them may try to create the role at the same moment.
  try {
    await admin.query(`CREATE ROLE ${role} ${attrs}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42710" && code !== "23505") throw err;
    await admin.query(`ALTER ROLE ${role} ${attrs}`);
  }
}

async function applied(db: pg.ClientBase): Promise<number[]> {
  await db.query("CREATE SCHEMA IF NOT EXISTS migrations");
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations.applied (version integer PRIMARY KEY, name text NOT NULL, at timestamptz NOT NULL DEFAULT now())",
  );
  const r = await db.query<{ version: number }>("SELECT version FROM migrations.applied ORDER BY version");
  return r.rows.map((x) => x.version);
}

export async function existingTables(db: pg.ClientBase): Promise<string[]> {
  const r = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
  );
  return r.rows.map((x) => x.tablename);
}

/** Apply the policies of `model` to the tables that exist (all of them after a full migration). */
export async function applyPolicies(db: pg.ClientBase, model: AccessModel = accessModel()): Promise<void> {
  const present = new Set(await existingTables(db));
  if (present.size === 0) return;
  const subset: AccessModel = {
    ...model,
    tables: Object.fromEntries(Object.entries(model.tables).filter(([t]) => present.has(t))),
  };
  await db.query(policiesSql(subset, platformConfig().database.runtime_role));
}

export async function syncSettings(db: pg.ClientBase): Promise<void> {
  const present = new Set(await existingTables(db));
  if (!present.has("settings")) return;
  const settings = settingsFromConfig();
  await db.query("DELETE FROM public.settings WHERE NOT (key = ANY ($1))", [Object.keys(settings)]);
  for (const [key, value] of Object.entries(settings)) {
    await db.query(
      "INSERT INTO public.settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [key, JSON.stringify(value)],
    );
  }
}

export async function migrateUp(db: pg.ClientBase, target = Number.POSITIVE_INFINITY): Promise<number[]> {
  const done = new Set(await applied(db));
  const ran: number[] = [];
  for (const m of migrations()) {
    if (done.has(m.version) || m.version > target) continue;
    await db.query("BEGIN");
    try {
      await db.query(m.up);
      await db.query("INSERT INTO migrations.applied (version, name) VALUES ($1, $2)", [m.version, m.name]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw new Error(`migration ${m.version}_${m.name} failed: ${(err as Error).message}`);
    }
    ran.push(m.version);
  }
  await syncSettings(db);
  await applyPolicies(db);
  return ran;
}

export async function migrateDown(db: pg.ClientBase, steps = 1): Promise<number[]> {
  const done = (await applied(db)).sort((a, b) => b - a).slice(0, steps);
  const all = new Map(migrations().map((m) => [m.version, m]));
  const ran: number[] = [];
  for (const v of done) {
    const m = all.get(v);
    if (!m) throw new Error(`applied migration ${v} has no file`);
    await db.query("BEGIN");
    try {
      await db.query(m.down);
      await db.query("DELETE FROM migrations.applied WHERE version = $1", [v]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw new Error(`down migration ${v}_${m.name} failed: ${(err as Error).message}`);
    }
    ran.push(v);
  }
  await syncSettings(db);
  await applyPolicies(db);
  return ran;
}
