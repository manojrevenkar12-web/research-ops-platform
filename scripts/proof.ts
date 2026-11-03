// The access proof as a report: the full matrix and every policy mutant on a fresh database with the fixture,
// written to reports/access/proof.json (the console shows it; the handover gate requires it to be current).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessModel } from "@rop/access";
import {
  createTestDb,
  loadFixture,
  MIGRATIONS,
  mismatches,
  principals,
  runMatrix,
  runMutants,
} from "@rop/db";
import { ROOT } from "@rop/platform";

/** What the proof depends on: if any of it changes, the proof must be run again. */
export function proofInputsHash(): string {
  const h = createHash("sha256");
  for (const f of [
    "config/access.yaml",
    "config/access_equivalent.yaml",
    "packages/db/src/fixtures.ts",
    "packages/db/src/proof.ts",
  ]) {
    h.update(readFileSync(join(ROOT, f)));
  }
  for (const f of readdirSync(MIGRATIONS).sort()) h.update(readFileSync(join(MIGRATIONS, f)));
  return h.digest("hex").slice(0, 16);
}

async function main() {
  const db = await createTestDb();
  const c = await db.admin.connect();
  await loadFixture(c).finally(() => c.release());
  const t0 = Date.now();
  try {
    const attempts = await runMatrix(db.admin, db.app);
    const wrong = mismatches(attempts);
    const mutants = await runMutants(db.admin, db.app, undefined, (s) =>
      process.stdout.write(s.endsWith("caught") ? "." : `\n${s}\n`),
    );
    process.stdout.write("\n");
    const tables = Object.keys(accessModel().tables);
    const people = principals();
    const byTable = Object.fromEntries(
      tables.map((t) => {
        const a = attempts.filter((x) => x.table === t);
        const m = mutants.filter((x) => x.table === t);
        return [
          t,
          {
            attempts: a.length,
            mismatches: wrong.filter((x) => x.table === t).length,
            inconclusive: a.filter((x) => x.actual === "inconclusive").length,
            mutants: m.length,
            caught: m.filter((x) => x.verdict === "caught").length,
            equivalent: m.filter((x) => x.verdict === "equivalent").length,
            survived: m.filter((x) => x.verdict === "survived" || x.verdict === "stale").length,
          },
        ];
      }),
    );
    // Who sees how much: rows visible per principal and table, for the console's who-can-see view.
    const visibility = people.map((p) => ({
      principal: p.label,
      roles: p.roles,
      entity: p.entity,
      tables: Object.fromEntries(
        tables.map((t) => {
          const sel = attempts.filter((x) => x.table === t && x.op === "select" && x.principal === p.label);
          return [t, { visible: sel.filter((x) => x.actual === "visible").length, rows: sel.length }];
        }),
      ),
    }));
    const report = {
      generated_at: new Date().toISOString(),
      inputs: proofInputsHash(),
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      summary: {
        principals: people.length,
        tables: tables.length,
        attempts: attempts.length,
        mismatches: wrong.length,
        inconclusive: attempts.filter((x) => x.actual === "inconclusive").length,
        mutants: mutants.length,
        caught: mutants.filter((x) => x.verdict === "caught").length,
        equivalent: mutants.filter((x) => x.verdict === "equivalent").length,
        survived: mutants.filter((x) => x.verdict === "survived").length,
        stale: mutants.filter((x) => x.verdict === "stale").length,
      },
      by_table: byTable,
      visibility,
      mismatches: wrong.slice(0, 50),
      mutants: mutants.map(({ id, table, description, verdict, reason, evidence }) => ({
        id,
        table,
        description,
        verdict,
        reason,
        evidence,
      })),
    };
    mkdirSync(join(ROOT, "reports", "access"), { recursive: true });
    writeFileSync(join(ROOT, "reports", "access", "proof.json"), `${JSON.stringify(report, null, 1)}\n`);
    const s = report.summary;
    console.log(
      `${s.attempts} attempts by ${s.principals} principals: ${s.mismatches} mismatches, ${s.inconclusive} inconclusive. ` +
        `${s.mutants} policy mutants: ${s.caught} caught, ${s.equivalent} equivalent, ${s.survived} survived, ${s.stale} stale.`,
    );
    if (s.mismatches || s.survived || s.stale) process.exitCode = 1;
  } finally {
    await db.drop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
