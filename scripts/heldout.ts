// Run a held-out set (heldout/<set>/cases.yaml), written from the documents by someone who has not read the
// code. The first run is written to reports/heldout/<set>/first_run.json and never rewritten; later runs go
// to latest.json. Do not change the code to pass a held-out set (see heldout/WRITING_CASES.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessModel } from "@rop/access";
import { type Entry, type GrantRef, grantPeriodCost, MissingSalaryError, type Salary } from "@rop/costs";
import { createTestDb, loadFixture, PERSONAS, servicePrincipal } from "@rop/db";
import { ROOT } from "@rop/platform";
import { parse } from "yaml";

interface CostCase {
  name: string;
  grant: { method: GrantRef["method"]; entity: string; funding_rate: number; indirect_rate: number };
  other_grants?: {
    id: string;
    method: GrantRef["method"];
    entity: string;
    funding_rate?: number;
    indirect_rate?: number;
  }[];
  people: Record<string, string>;
  salaries: {
    person: string;
    year: number;
    annual_cost_eur: number;
    contract_hours: number;
    managing_director?: boolean;
  }[];
  entries: {
    person: string;
    grant: string | null;
    date: string;
    hours: number;
    status: Entry["status"];
    late?: boolean;
  }[];
  period: string;
  expect?: Record<string, unknown> & { lines?: Record<string, Record<string, string>> };
  expect_error?: string;
}

interface AccessCase {
  name: string;
  as: string;
  table: string;
  op: "select" | "insert" | "update" | "delete";
  row?: Record<string, unknown>;
  values?: Record<string, unknown>;
  change?: Record<string, unknown>;
  expect: string;
}

interface Outcome {
  name: string;
  kind: "cost" | "access";
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not a column or table name: ${s}`);
  return s;
};
const asText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

function runCost(c: CostCase): Outcome {
  const grant: GrantRef = { id: "this", ...c.grant };
  const grants: GrantRef[] = [
    grant,
    ...(c.other_grants ?? []).map((g) => ({ funding_rate: 1, indirect_rate: 0, ...g })),
  ];
  const entries: Entry[] = c.entries.map((e) => ({
    person_id: e.person,
    grant_id: e.grant,
    work_date: String(asText(e.date)),
    hours: e.hours,
    status: e.status,
    late: e.late ?? false,
  }));
  const salaries: Salary[] = c.salaries.map((s) => ({
    person_id: s.person,
    year: s.year,
    annual_cost_eur: s.annual_cost_eur,
    contract_hours: s.contract_hours,
    managing_director: s.managing_director ?? false,
  }));
  try {
    const r = grantPeriodCost(
      { grant, grants, entries, salaries, people: c.people },
      String(asText(c.period)).slice(0, 7),
    );
    if (c.expect_error)
      return { name: c.name, kind: "cost", pass: false, expected: { error: c.expect_error }, actual: r };
    const actual: Record<string, unknown> = {};
    let pass = true;
    for (const [k, v] of Object.entries(c.expect ?? {})) {
      if (k === "lines") continue;
      const got = (r as unknown as Record<string, unknown>)[k];
      actual[k] = got;
      if (String(got) !== String(v)) pass = false;
    }
    const lines: Record<string, Record<string, unknown>> = {};
    for (const [person, want] of Object.entries(c.expect?.lines ?? {})) {
      const line = r.lines.find((l) => l.person_id === person) as unknown as
        | Record<string, unknown>
        | undefined;
      lines[person] = {};
      for (const [k, v] of Object.entries(want)) {
        lines[person][k] = line?.[k];
        if (String(line?.[k]) !== String(v)) pass = false;
      }
    }
    if (Object.keys(lines).length) actual.lines = lines;
    return { name: c.name, kind: "cost", pass, expected: c.expect, actual };
  } catch (err) {
    const code =
      err instanceof MissingSalaryError ? "missing_personnel_cost" : `error: ${(err as Error).message}`;
    return {
      name: c.name,
      kind: "cost",
      pass: c.expect_error === code,
      expected: c.expect_error ?? c.expect,
      actual: code,
    };
  }
}

async function runAccess(cases: AccessCase[]): Promise<Outcome[]> {
  const db = await createTestDb();
  const a = await db.admin.connect();
  await loadFixture(a).finally(() => a.release());
  const out: Outcome[] = [];
  const client = await db.app.connect();
  try {
    for (const c of cases) {
      // A fixture person by key, or a scheduled job by its service principal name (docs/FIXTURE.md lists both).
      const who =
        PERSONAS[c.as as keyof typeof PERSONAS] ??
        (accessModel().service_principals[c.as] ? servicePrincipal(c.as) : undefined);
      let actual: string;
      try {
        if (!who) throw new Error(`unknown person ${c.as}`);
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.person_id', $1, true), set_config('app.roles', $2, true), set_config('app.entity', $3, true)",
          [who.personId, who.roles.join(","), who.entity],
        );
        const t = ident(c.table);
        const where = Object.keys(c.row ?? {});
        const whereSql = where.map((k, i) => `${ident(k)}::text = $${i + 1}::text`).join(" AND ") || "true";
        const whereVals = where.map((k) => String(asText(c.row![k])));
        await client.query("SAVEPOINT s");
        try {
          if (c.op === "select") {
            const r = await client.query(
              `SELECT count(*)::int AS n FROM public.${t} WHERE ${whereSql}`,
              whereVals,
            );
            actual = r.rows[0].n > 0 ? "visible" : "hidden";
          } else if (c.op === "insert") {
            const cols = Object.keys(c.values ?? {});
            await client.query(
              `INSERT INTO public.${t} (${cols.map(ident).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
              cols.map((k) => {
                const v = asText(c.values![k]);
                return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
              }),
            );
            actual = "allowed";
          } else if (c.op === "update") {
            const cols = Object.keys(c.change ?? {});
            const r = await client.query(
              `UPDATE public.${t} SET ${cols.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ")} WHERE ${
                where.map((k, i) => `${ident(k)}::text = $${cols.length + i + 1}::text`).join(" AND ") ||
                "true"
              }`,
              [...cols.map((k) => asText(c.change![k])), ...whereVals],
            );
            actual = (r.rowCount ?? 0) > 0 ? "allowed" : "denied";
          } else {
            const r = await client.query(`DELETE FROM public.${t} WHERE ${whereSql}`, whereVals);
            actual = (r.rowCount ?? 0) > 0 ? "allowed" : "denied";
          }
        } catch (err) {
          actual = c.op === "select" ? `error: ${(err as Error).message}` : "denied";
          if (c.op === "select" && /permission denied/.test((err as Error).message)) actual = "hidden";
          await client.query("ROLLBACK TO SAVEPOINT s");
        }
      } catch (err) {
        actual = `invalid case: ${(err as Error).message}`;
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
      out.push({ name: c.name, kind: "access", pass: actual === c.expect, expected: c.expect, actual });
    }
  } finally {
    client.release();
    await db.drop();
  }
  return out;
}

const set = process.argv[2] ?? "blind-1";
const dir = join(ROOT, "heldout", set);
const raw = parse(readFileSync(join(dir, "cases.yaml"), "utf8")) as {
  cost_cases?: CostCase[];
  access_cases?: AccessCase[];
};
const status = existsSync(join(dir, "STATUS")) ? readFileSync(join(dir, "STATUS"), "utf8").trim() : "heldout";
const results = [...(raw.cost_cases ?? []).map(runCost), ...(await runAccess(raw.access_cases ?? []))];
const summary = (kind: string) => {
  const r = results.filter((x) => x.kind === kind);
  return { cases: r.length, passed: r.filter((x) => x.pass).length };
};
const report = {
  set,
  status,
  run_at: new Date().toISOString(),
  cost: summary("cost"),
  access: summary("access"),
  failures: results.filter((r) => !r.pass),
  results,
};
const out = join(ROOT, "reports", "heldout", set);
mkdirSync(out, { recursive: true });
const first = join(out, "first_run.json");
const target = existsSync(first) ? join(out, "latest.json") : first;
writeFileSync(target, `${JSON.stringify(report, null, 1)}\n`);
console.log(
  `${set} (${status}): cost ${report.cost.passed}/${report.cost.cases}, access ${report.access.passed}/${report.access.cases} -> ${target.slice(ROOT.length + 1)}`,
);
for (const f of report.failures)
  console.log(
    `  FAIL ${f.kind}: ${f.name}\n    expected ${JSON.stringify(f.expected)}\n    actual   ${JSON.stringify(f.actual)}`,
  );
