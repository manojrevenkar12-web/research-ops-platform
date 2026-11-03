// The access proof: every principal tries every operation on every fixture row against the real database,
// and the result must equal what the reference evaluator computes from config/access.yaml. Policy mutants
// then check that the fixtures are strong enough to notice a weakened or missing rule.
import {
  type AccessModel,
  accessModel,
  Evaluator,
  type Op,
  type Principal,
  policyMutants,
  type Row,
  type Snapshot,
  tablePoliciesSql,
} from "@rop/access";
import { platformConfig, rawConfig } from "@rop/platform";
import pg from "pg";
import { FIXTURE, ID, PERSONAS, servicePrincipal } from "./fixtures";
import { pgCode } from "./session";

pg.types.setTypeParser(1082, (v) => v); // dates stay "YYYY-MM-DD"

export type Outcome = "allowed" | "denied" | "skipped";
export interface Attempt {
  table: string;
  op: Op;
  principal: string;
  subject: string;
  /** allowed | denied | skipped | visible | hidden, or allowed:<rows> for statements without a WHERE clause */
  expected: string;
  actual: string;
  detail?: string;
}

export function principals(): Principal[] {
  const people = Object.values(PERSONAS);
  const services = Object.keys(accessModel().service_principals).map(servicePrincipal);
  return [...people, ...services];
}

const label = (p: Principal) => p.label ?? p.personId;

/** Insert candidates, as functions of who is trying, so "as myself" and "as someone else" both appear. */
function insertCandidates(table: string, who: Principal): Row[] {
  const me = who.personId;
  const other = me === PERSONAS.ben.personId ? PERSONAS.ana.personId : PERSONAS.ben.personId;
  const n = (s: string) => `${s}-${who.personId.slice(-4)}`;
  switch (table) {
    case "people":
      return [
        {
          id: "00000000-0000-4000-8000-00ff00000001",
          entra_oid: "00000000-0000-4000-8000-00ff00000002",
          display_name: "X",
          email: n("x@example.com"),
          entity: "DE",
          team: "X",
        },
      ];
    case "campaigns":
      return [
        {
          code: n("NEW-I"),
          title: "t",
          facility: "f",
          entity: "DE",
          classification: "internal",
          lead_id: me,
          starts_on: "2026-11-01",
        },
        {
          code: n("NEW-R"),
          title: "t",
          facility: "f",
          entity: "DE",
          classification: "restricted",
          lead_id: me,
          starts_on: "2026-11-01",
        },
        {
          code: n("NEW-O"),
          title: "t",
          facility: "f",
          entity: "DE",
          classification: "internal",
          lead_id: other,
          starts_on: "2026-11-01",
        },
      ];
    case "campaign_members":
      return [ID.c1, ID.c2, ID.c3, ID.c4].map((c) => ({
        campaign_id: c,
        person_id: PERSONAS.gus.personId,
        role: "observer",
      }));
    case "shots":
      return [
        {
          campaign_id: ID.c1,
          shot_no: 90,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "restricted",
          logged_by: me,
        },
        {
          campaign_id: ID.c2,
          shot_no: 90,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "internal",
          logged_by: me,
        },
        {
          campaign_id: ID.c2,
          shot_no: 91,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "restricted",
          logged_by: me,
        },
        {
          campaign_id: ID.c3,
          shot_no: 90,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "internal",
          logged_by: me,
        },
        {
          campaign_id: ID.c4,
          shot_no: 90,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "internal",
          logged_by: me,
        },
        {
          campaign_id: ID.c2,
          shot_no: 92,
          fired_at: "2026-11-01T10:00:00Z",
          outcome: "nominal",
          classification: "internal",
          logged_by: other,
        },
      ];
    case "targets":
      return [
        { serial: n("NEW-F"), batch: "B", design: "D", status: "fabricated" },
        { serial: n("NEW-C"), batch: "B", design: "D", status: "characterized" },
      ];
    case "target_events":
      return [{ target_id: ID.t(4), to_status: "characterized", by_person: me }];
    case "grants":
      return [
        {
          code: n("G"),
          title: "t",
          funder: "f",
          method: "eu_daily",
          entity: "DE",
          starts_on: "2026-01-01",
          ends_on: "2026-12-31",
          funding_rate: 0.5,
          indirect_rate: 0.25,
        },
      ];
    case "work_packages":
      return [{ grant_id: ID.g2, code: n("WP"), title: "t" }];
    case "grant_members":
      return [{ grant_id: ID.g2, person_id: PERSONAS.cleo.personId, role: "member" }];
    case "time_entries":
      return [
        { person_id: me, work_date: "2026-10-21", activity: "a", hours: 1, status: "draft" },
        { person_id: me, work_date: "2026-10-21", activity: "a", hours: 1, status: "submitted" },
        { person_id: me, work_date: "2026-10-21", activity: "a", hours: 1, status: "approved" },
        { person_id: me, work_date: "2026-10-21", activity: "a", hours: 1, status: "returned" },
        { person_id: other, work_date: "2026-10-21", activity: "a", hours: 1, status: "draft" },
      ];
    case "salary_costs":
      return [
        {
          person_id: PERSONAS.hana.personId,
          entity: "DE",
          year: 2027,
          annual_cost_eur: 1,
          contract_hours: 1,
        },
        { person_id: PERSONAS.ivo.personId, entity: "US", year: 2027, annual_cost_eur: 1, contract_hours: 1 },
      ];
    case "cost_periods":
      return [{ grant_id: ID.g2, period: "2026-11", status: "open" }];
    case "grant_cost_snapshots":
      return [
        {
          grant_id: ID.g2,
          period: "2026-11",
          direct_eur: 1,
          indirect_eur: 1,
          funded_eur: 1,
          contributors: 3,
        },
      ];
    case "audit_events":
      return [{ table_name: "x", row_id: "x", action: "insert", change: "{}" }];
    case "outbox":
      return [{ topic: "x", payload: "{}" }];
    case "settings":
      return [{ key: "x", value: "1" }];
    default:
      return [];
  }
}

/** Changes tried on every existing row. */
function updateChanges(table: string): Row[] {
  const { ana, ben } = PERSONAS;
  switch (table) {
    case "people":
      return [{ team: "X" }];
    case "campaigns":
      return [
        { title: "renamed" },
        { lead_id: ana.personId },
        { lead_id: ben.personId },
        { classification: "internal" },
        { classification: "restricted" },
      ];
    case "targets":
      return [{ characterization: '{"note":"x"}' }];
    case "grants":
      return [{ title: "renamed" }];
    case "time_entries":
      return [
        { status: "submitted" },
        { status: "approved" },
        { status: "returned" },
        { status: "draft" },
        { activity: "edited" },
      ];
    case "salary_costs":
      return [{ annual_cost_eur: 1 }];
    case "cost_periods":
      return [{ status: "closed" }];
    case "grant_cost_snapshots":
      return [{ funded_eur: 1 }];
    case "outbox":
      return [{ dispatched_at: "2026-11-01T00:00:00Z" }];
    case "shots":
      return [{ notes: "rewritten" }];
    case "audit_events":
      return [{ action: "delete" }];
    case "settings":
      return [{ value: "99" }];
    default:
      return [];
  }
}

async function primaryKeys(admin: pg.ClientBase): Promise<Record<string, string[]>> {
  const r = await admin.query<{ table: string; cols: string[] }>(`
    SELECT c.relname AS table, array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) AS cols
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
    WHERE i.indisprimary AND n.nspname = 'public' GROUP BY c.relname`);
  return Object.fromEntries(r.rows.map((x) => [x.table, x.cols]));
}

export async function takeSnapshot(admin: pg.ClientBase, tables: string[]): Promise<Snapshot> {
  const snap: Snapshot = {};
  for (const t of tables) {
    const r = await admin.query(`SELECT * FROM public.${t}`);
    snap[t] = r.rows.map((row) => normalise(row));
  }
  return snap;
}

function normalise(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

const keyOf = (row: Row, pk: string[]) => pk.map((c) => String(row[c])).join("/");

async function asWho(client: pg.ClientBase, who: Principal) {
  await client.query(
    "SELECT set_config('app.person_id', $1, true), set_config('app.roles', $2, true), set_config('app.entity', $3, true)",
    [who.personId, who.roles.join(","), who.entity],
  );
}

async function attempt(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
): Promise<{ rows: number } | { code: string; message: string }> {
  await client.query("SAVEPOINT a");
  try {
    const r = await client.query(sql, params);
    return { rows: r.rowCount ?? 0 };
  } catch (err) {
    return { code: pgCode(err) ?? "?", message: (err as Error).message };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT a");
  }
}

export interface MatrixOptions {
  tables?: string[];
  ops?: Op[];
  model?: AccessModel;
}

/** Run the matrix. The evaluator always uses the real model; the database has whatever policies are applied. */
export async function runMatrix(admin: pg.Pool, app: pg.Pool, opts: MatrixOptions = {}): Promise<Attempt[]> {
  const model = opts.model ?? accessModel();
  const allTables = Object.keys(model.tables);
  const tables = opts.tables ?? allTables;
  const ops = opts.ops ?? (["select", "insert", "update", "delete"] as Op[]);
  const a = await admin.connect();
  let snap: Snapshot;
  let pks: Record<string, string[]>;
  try {
    snap = await takeSnapshot(a, allTables);
    pks = await primaryKeys(a);
  } finally {
    a.release();
  }
  const ev = new Evaluator(model, snap);
  const out: Attempt[] = [];
  const client = await app.connect();
  try {
    for (const who of principals()) {
      await client.query("BEGIN");
      await asWho(client, who);
      for (const table of tables) {
        const t = model.tables[table]!;
        const pk = pks[table]!;
        const rows = snap[table] ?? [];
        if (ops.includes("select")) {
          let seen = new Set<string>();
          await client.query("SAVEPOINT s");
          try {
            const res = await client.query(`SELECT ${pk.join(", ")} FROM public.${table}`);
            seen = new Set(res.rows.map((x: Row) => keyOf(normalise(x), pk)));
          } catch (err) {
            if (pgCode(err) !== "42501") throw err;
          } finally {
            await client.query("ROLLBACK TO SAVEPOINT s");
          }
          for (const row of rows) {
            const k = keyOf(row, pk);
            out.push({
              table,
              op: "select",
              principal: label(who),
              subject: k,
              expected: ev.canSelect(table, row, who) ? "visible" : "hidden",
              actual: seen.has(k) ? "visible" : "hidden",
            });
          }
        }
        if (ops.includes("insert")) {
          for (const cand of insertCandidates(table, who)) {
            const cols = Object.keys(cand);
            const r = await attempt(
              client,
              `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
              cols.map((c) => cand[c]),
            );
            const expected: Outcome =
              t.insert.length === 0
                ? "denied"
                : ev.canInsert(table, withEntity(table, cand), who)
                  ? "allowed"
                  : "denied";
            out.push({
              table,
              op: "insert",
              principal: label(who),
              subject: JSON.stringify(cand),
              expected,
              ...classify(r),
            });
          }
        }
        if (ops.includes("update")) {
          for (const row of rows) {
            for (const change of updateChanges(table)) {
              const cols = Object.keys(change);
              const r = await attempt(
                client,
                `UPDATE public.${table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE ${pk.map((c, i) => `${c} = $${cols.length + i + 1}`).join(" AND ")}`,
                [...cols.map((c) => change[c]), ...pk.map((c) => row[c])],
              );
              const expected: Outcome =
                t.update.length === 0 ? "denied" : ev.updateOutcome(table, row, { ...row, ...change }, who);
              out.push({
                table,
                op: "update",
                principal: label(who),
                subject: `${keyOf(row, pk)} ${JSON.stringify(change)}`,
                expected,
                ...classify(r),
              });
            }
          }
        }
        if (ops.includes("update")) {
          // Without a WHERE clause no SELECT policy applies: this is where a too-wide UPDATE rule shows.
          for (const change of updateChanges(table)) {
            const cols = Object.keys(change);
            const r = await attempt(
              client,
              `UPDATE public.${table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}`,
              cols.map((c) => change[c]),
            );
            const expected = t.update.length === 0 ? "denied" : ev.blindUpdate(table, change, who);
            out.push({
              table,
              op: "update",
              principal: label(who),
              subject: `ALL ${JSON.stringify(change)}`,
              expected,
              ...classify(r, true),
            });
          }
        }
        if (ops.includes("delete")) {
          const all = await attempt(client, `DELETE FROM public.${table}`, []);
          const expectedAll = t.delete.length === 0 ? "denied" : ev.blindDelete(table, who);
          out.push({
            table,
            op: "delete",
            principal: label(who),
            subject: "ALL",
            expected: expectedAll,
            ...classify(all, true),
          });
          for (const row of rows) {
            const r = await attempt(
              client,
              `DELETE FROM public.${table} WHERE ${pk.map((c, i) => `${c} = $${i + 1}`).join(" AND ")}`,
              pk.map((c) => row[c]),
            );
            const expected: Outcome = t.delete.length === 0 ? "denied" : ev.deleteOutcome(table, row, who);
            out.push({
              table,
              op: "delete",
              principal: label(who),
              subject: keyOf(row, pk),
              expected,
              ...classify(r),
            });
          }
        }
      }
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
  return out;
}

/** salary_costs.entity is set by a trigger from the person; the evaluator must judge the row the database checks. */
function withEntity(table: string, row: Row): Row {
  if (table !== "salary_costs") return row;
  const person = FIXTURE.people.find((p) => p.id === row.person_id);
  return { ...row, entity: person?.entity };
}

function classify(
  r: { rows: number } | { code: string; message: string },
  counted = false,
): Pick<Attempt, "actual" | "detail"> {
  if ("rows" in r) return { actual: r.rows > 0 ? (counted ? `allowed:${r.rows}` : "allowed") : "skipped" };
  if (r.code === "42501") return { actual: "denied", detail: r.message };
  // A trigger or constraint stopped it after row security let it through: not a statement about access.
  return { actual: "inconclusive", detail: `${r.code} ${r.message}` };
}

export function mismatches(attempts: Attempt[]): Attempt[] {
  return attempts.filter((x) => x.actual !== "inconclusive" && x.actual !== x.expected);
}

export interface MutantResult {
  id: string;
  table: string;
  description: string;
  caught: boolean;
  /** caught; equivalent (survived, with a reviewed reason); survived (a gap); stale (listed as equivalent but caught) */
  verdict: "caught" | "equivalent" | "survived" | "stale";
  reason?: string;
  evidence?: string;
}

export function equivalentMutants(): Record<string, string> {
  const raw = rawConfig("access_equivalent.yaml") as { equivalent?: Record<string, { reason: string }> };
  return Object.fromEntries(Object.entries(raw.equivalent ?? {}).map(([k, v]) => [k, v.reason]));
}

export async function runMutants(
  admin: pg.Pool,
  app: pg.Pool,
  onlyTables?: string[],
  log: (s: string) => void = () => {},
): Promise<MutantResult[]> {
  const model = accessModel();
  const role = platformConfig().database.runtime_role;
  const results: MutantResult[] = [];
  const equivalent = equivalentMutants();
  for (const m of policyMutants(model, onlyTables)) {
    const op = m.id.split(".")[1]!.split("[")[0] as Op;
    const ops: Op[] = op === "select" ? ["select", "insert", "update", "delete"] : [op];
    const c = await admin.connect();
    try {
      await c.query(tablePoliciesSql(m.table, m.model.tables[m.table]!, role));
    } finally {
      c.release();
    }
    try {
      const diff = mismatches(await runMatrix(admin, app, { tables: [m.table], ops }));
      const first = diff[0];
      const caught = diff.length > 0;
      const reason = equivalent[m.id];
      results.push({
        id: m.id,
        table: m.table,
        description: m.description,
        caught,
        verdict: caught ? (reason ? "stale" : "caught") : reason ? "equivalent" : "survived",
        ...(reason ? { reason } : {}),
        ...(first
          ? {
              evidence: `${first.principal} ${first.op} ${first.subject}: expected ${first.expected}, got ${first.actual}`,
            }
          : {}),
      });
      log(`${m.id}: ${diff.length > 0 ? "caught" : "SURVIVED"}`);
    } finally {
      const r = await admin.connect();
      try {
        await r.query(tablePoliciesSql(m.table, model.tables[m.table]!, role));
      } finally {
        r.release();
      }
    }
  }
  return results;
}
