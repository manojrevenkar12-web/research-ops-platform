import { execFileSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migrateDown, migrateUp, migrations, type TestDb } from "../src";

function schemaDump(url: string): string {
  const out = execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-comments", url], {
    encoding: "utf8",
  });
  // pg_dump writes a random restrict key in PostgreSQL >= 16.10; it is not part of the schema.
  return out
    .split("\n")
    .filter((l) => !l.startsWith("\\restrict") && !l.startsWith("\\unrestrict") && !l.startsWith("--"))
    .join("\n");
}

describe("migrations", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
  });
  afterAll(async () => db.drop());

  it("every step down restores the schema exactly as it was before the step up", async () => {
    const c = await db.admin.connect();
    try {
      const versions = migrations().map((m) => m.version);
      expect(versions.length).toBeGreaterThanOrEqual(3);
      let previous = 0;
      for (const v of versions) {
        await migrateUp(c, previous);
        const before = schemaDump(db.urls.admin);
        await migrateUp(c, v);
        await migrateDown(c, 1);
        const after = schemaDump(db.urls.admin);
        expect(after, `migration ${v} is not reversible`).toBe(before);
        await migrateUp(c, v);
        previous = v;
      }
      const full = schemaDump(db.urls.admin);
      await migrateDown(c, versions.length);
      await migrateUp(c);
      expect(schemaDump(db.urls.admin)).toBe(full);
    } finally {
      c.release();
    }
  });

  it("the runtime role owns nothing, cannot bypass row security and every public table has it enabled", async () => {
    const c = await db.admin.connect();
    await migrateUp(c).finally(() => c.release());
    const tables = await db.admin.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(tables.rows[0].n).toBeGreaterThan(10);
    const role = await db.admin.query(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'rop_app'",
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const owned = await db.admin.query(
      "SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'rop_app'",
    );
    expect(owned.rows[0].n).toBe(0);
    const noRls = await db.admin.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity",
    );
    expect(noRls.rows).toEqual([]);
  });

  it("the runtime role cannot read the migration bookkeeping or create objects", async () => {
    const c = new pg.Client({ connectionString: db.urls.app });
    await c.connect();
    try {
      await expect(c.query("SELECT * FROM migrations.applied")).rejects.toThrow(/permission denied/);
      await expect(c.query("CREATE TABLE public.sneaky (x int)")).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});
