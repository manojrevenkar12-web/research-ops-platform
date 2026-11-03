// Read what the cost engine needs, as whoever is asking. Under row security only Finance (and the snapshot
// job, which acts with the Finance role) can read every entry and the personnel costs of its own entity; for
// anyone else the inputs come back incomplete and the computation refuses rather than guessing.
import type pg from "pg";
import {
  type CostInput,
  type CostResult,
  type Entry,
  type GrantRef,
  grantPeriodCost,
  type Salary,
} from "./index";

export class GrantNotFoundError extends Error {}

export async function loadCostInput(db: pg.ClientBase, grantId: string, period: string): Promise<CostInput> {
  const year = Number(period.slice(0, 4));
  const g = await db.query<GrantRef>(
    "SELECT id, method, entity, funding_rate, indirect_rate FROM grants WHERE id = $1",
    [grantId],
  );
  if (!g.rowCount) throw new GrantNotFoundError(grantId);
  const grants = (
    await db.query<GrantRef>("SELECT id, method, entity, funding_rate, indirect_rate FROM grants")
  ).rows;
  // Everyone who booked to this grant this year, and everything they booked this year (the hourly rate and
  // the day cap depend on all of it).
  const entries = (
    await db.query<Entry>(
      `SELECT person_id, grant_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, hours, status, late FROM time_entries
        WHERE extract(year FROM work_date) = $2
          AND person_id IN (SELECT person_id FROM time_entries WHERE grant_id = $1 AND extract(year FROM work_date) = $2)`,
      [grantId, year],
    )
  ).rows;
  const salaries = (
    await db.query<Salary>(
      "SELECT person_id, year, annual_cost_eur, contract_hours, managing_director FROM salary_costs WHERE year = $1",
      [year],
    )
  ).rows;
  const people = Object.fromEntries(
    (await db.query<{ id: string; entity: string }>("SELECT id, entity FROM people")).rows.map((p) => [
      p.id,
      p.entity,
    ]),
  );
  return { grant: g.rows[0]!, grants, entries, salaries, people };
}

export async function computeGrantCost(
  db: pg.ClientBase,
  grantId: string,
  period: string,
): Promise<CostResult> {
  return grantPeriodCost(await loadCostInput(db, grantId, period), period);
}

/** Store the period's figures; refused by the database once the period is closed. */
export async function writeSnapshot(db: pg.ClientBase, r: CostResult): Promise<void> {
  await db.query(
    `INSERT INTO grant_cost_snapshots (grant_id, period, direct_eur, indirect_eur, funded_eur, ineligible_hours, contributors)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (grant_id, period) DO UPDATE SET direct_eur = EXCLUDED.direct_eur, indirect_eur = EXCLUDED.indirect_eur,
       funded_eur = EXCLUDED.funded_eur, ineligible_hours = EXCLUDED.ineligible_hours, contributors = EXCLUDED.contributors`,
    [r.grant_id, r.period, r.direct_eur, r.indirect_eur, r.funded_eur, r.ineligible_hours, r.contributors],
  );
}
