// A fresh database per test file, built by the real migrations and used through the real runtime role.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { ensureRuntimeRole, migrateUp } from "./migrate";
import { createPool, dbUrls, withDatabase } from "./session";

export interface TestDb {
  name: string;
  admin: pg.Pool;
  app: pg.Pool;
  urls: { admin: string; app: string };
  drop(): Promise<void>;
}

export async function createTestDb(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const base = dbUrls();
  const name = `rop_test_${randomBytes(5).toString("hex")}`;
  const root = new pg.Client({ connectionString: withDatabase(base.admin, "postgres") });
  await root.connect();
  try {
    await ensureRuntimeRole(root, new URL(base.app).password || "rop_app");
    await root.query(`CREATE DATABASE ${name}`);
  } finally {
    await root.end();
  }
  const urls = { admin: withDatabase(base.admin, name), app: withDatabase(base.app, name) };
  const admin = new pg.Pool({ connectionString: urls.admin, max: 4 });
  admin.on("error", () => {});
  if (opts.migrate !== false) {
    const c = await admin.connect();
    try {
      await migrateUp(c);
    } finally {
      c.release();
    }
  }
  const app = createPool(urls.app);
  return {
    name,
    admin,
    app,
    urls,
    async drop() {
      await app.end();
      await admin.end();
      const r = new pg.Client({ connectionString: withDatabase(base.admin, "postgres") });
      await r.connect();
      try {
        await r.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await r.end();
      }
    },
  };
}
