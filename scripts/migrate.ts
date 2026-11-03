// pnpm migrate [up|down] [steps]: run as the schema owner (ROP_DATABASE_URL).
import { dbUrls, ensureRuntimeRole, migrateDown, migrateUp } from "@rop/db";
import pg from "pg";

const [cmd = "up", steps = "1"] = process.argv.slice(2);
const c = new pg.Client({ connectionString: dbUrls().admin });
await c.connect();
try {
  if (process.env.ROP_APP_PASSWORD || !process.env.ROP_DB_AUTH)
    await ensureRuntimeRole(c, process.env.ROP_APP_PASSWORD ?? "rop_app");
  const ran = cmd === "down" ? await migrateDown(c, Number(steps)) : await migrateUp(c);
  console.log(
    `${cmd}: ${ran.length ? ran.join(", ") : "nothing to do"}; settings and row-level security policies applied`,
  );
} finally {
  await c.end();
}
