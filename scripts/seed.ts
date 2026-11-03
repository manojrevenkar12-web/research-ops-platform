// Load the fixture personas and data into the local database for development and demos.
import { dbUrls, loadFixture } from "@rop/db";
import pg from "pg";

const c = new pg.Client({ connectionString: dbUrls().admin });
await c.connect();
try {
  const n = await c.query("SELECT count(*)::int AS n FROM people");
  if (n.rows[0].n > 0) {
    console.log("already seeded");
  } else {
    await loadFixture(c);
    console.log("seeded the fixture: 10 people, 5 campaigns, 2 grants");
  }
} finally {
  await c.end();
}
