// Put the local database back to the fixture before the end-to-end tests (they change data).
import { dbUrls, existingTables, loadFixture, syncSettings } from "@rop/db";
import pg from "pg";

const c = new pg.Client({ connectionString: dbUrls().admin });
await c.connect();
try {
  const tables = (await existingTables(c)).filter((t) => t !== "settings");
  await c.query(`TRUNCATE ${tables.map((t) => `public.${t}`).join(", ")} RESTART IDENTITY CASCADE`);
  await syncSettings(c);
  await loadFixture(c);
  console.log(`reset ${tables.length} tables to the fixture`);
} finally {
  await c.end();
}
