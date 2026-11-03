// Personnel costs a grant may claim, from approved hours and annual personnel costs.
//
// Pure functions: the API, the scheduled snapshot job and the held-out cases all call `grantPeriodCost`
// with rows they read; nothing here touches the database. Rules come from config/grants.yaml and are
// explained, with sources, in docs/GRANT_RULES.md.
//
// Amounts are computed year-to-date and the period's amount is the difference to the previous period's
// year-to-date figure. A rate that changes during the year (more hours worked than the contract says, a
// salary correction) therefore lands as an adjustment in the open period instead of rewriting a closed one.
import { type GrantsConfig, grantsConfig } from "@rop/platform";
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Method = "eu_daily" | "de_hourly";

export interface GrantRef {
  id: string;
  method: Method;
  /** The legal entity that holds the grant; only its own employees' hours are personnel costs. */
  entity: string;
  funding_rate: number | string;
  indirect_rate: number | string;
}

export interface Entry {
  person_id: string;
  grant_id: string | null;
  work_date: string; // YYYY-MM-DD
  hours: number | string;
  status: "draft" | "submitted" | "approved" | "returned";
  late: boolean;
}

export interface Salary {
  person_id: string;
  year: number;
  annual_cost_eur: number | string;
  contract_hours: number | string;
  managing_director: boolean;
}

export interface PersonLine {
  person_id: string;
  approved_hours: string;
  eligible_hours: string;
  late_hours: string;
  over_cap_hours: string;
  /** hours of someone employed by another entity: claimable only through an intercompany agreement */
  other_entity_hours: string;
  rate_eur: string; // per hour (de_hourly) or per day (eu_daily)
  rate_unit: "hour" | "day";
  direct_eur: string;
}

export interface CostResult {
  grant_id: string;
  period: string;
  lines: PersonLine[];
  direct_eur: string;
  indirect_eur: string;
  funded_eur: string;
  ineligible_hours: string;
  contributors: number;
}

export class MissingSalaryError extends Error {
  constructor(
    readonly people: string[],
    readonly year: number,
  ) {
    super(`no personnel cost for ${people.length} person(s) in ${year}`);
    this.name = "MissingSalaryError";
  }
}

const D = (x: number | string | Decimal) => new Decimal(x);
const cents = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fmt = (x: Decimal) => x.toFixed(2);

export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string | null {
  const [y, m] = period.split("-").map(Number) as [number, number];
  if (m === 1) return null; // year-to-date restarts in January
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

interface YtdLine {
  otherEntity: Decimal;
  approved: Decimal;
  eligible: Decimal;
  late: Decimal;
  overCap: Decimal;
  rate: Decimal;
  unit: "hour" | "day";
  direct: Decimal;
}

/** Year-to-date cost of one grant through the end of `period`, per person, rounded per line. */
function ytd(input: CostInput, period: string, cfg: GrantsConfig): Map<string, YtdLine> {
  const { grant, grants, entries, salaries, people: entityOf } = input;
  const year = Number(period.slice(0, 4));
  const from = `${year}-01-01`;
  const to = periodEnd(period);
  const inYtd = (e: Entry) => e.work_date >= from && e.work_date <= to;
  const ours = entries.filter((e) => e.grant_id === grant.id && e.status === "approved" && inYtd(e));
  const people = [...new Set(ours.map((e) => e.person_id))].sort();
  const own = (p: string) => entityOf[p] === grant.entity;
  const salaryOf = new Map(salaries.filter((s) => s.year === year).map((s) => [s.person_id, s]));
  const missing = people.filter((p) => own(p) && !salaryOf.has(p));
  if (missing.length) throw new MissingSalaryError(missing, year);

  const lateCounts = cfg.time_recording.late_entries_eligible;
  const eligibleOf = (e: Entry) => (e.late && !lateCounts ? D(0) : D(e.hours));
  const methodOf = new Map(grants.map((g) => [g.id, g.method]));
  const out = new Map<string, YtdLine>();

  for (const p of people) {
    const mine = ours.filter((e) => e.person_id === p);
    const approved = mine.reduce((a, e) => a.plus(e.hours), D(0));
    const eligible = mine.reduce((a, e) => a.plus(eligibleOf(e)), D(0));
    const late = approved.minus(eligible);
    if (!own(p)) {
      const z = D(0);
      out.set(p, {
        otherEntity: eligible,
        approved,
        eligible: z,
        late,
        overCap: z,
        rate: z,
        unit: grant.method === "eu_daily" ? "day" : "hour",
        direct: z,
      });
      continue;
    }
    const sal = salaryOf.get(p)!;
    const annual = D(sal.annual_cost_eur);

    if (grant.method === "de_hourly") {
      const rules = cfg.methods.de_hourly;
      // Actual hours are all hours the person recorded this year so far, funded or not.
      const actual = entries
        .filter((e) => e.person_id === p && inYtd(e) && e.status !== "returned")
        .reduce((a, e) => a.plus(e.hours), D(0));
      let rate = annual.div(Decimal.max(D(sal.contract_hours), actual));
      if (sal.managing_director) rate = Decimal.min(rate, D(rules.managing_director_max_hourly_eur));
      out.set(p, {
        otherEntity: D(0),
        approved,
        eligible,
        late,
        overCap: D(0),
        rate,
        unit: "hour",
        direct: cents(eligible.mul(rate)),
      });
    } else {
      const rules = cfg.methods.eu_daily;
      const dayHours = D(rules.day_equivalent_hours);
      const days = eligible.div(dayHours);
      // The day cap applies to the person across every daily-rate grant together.
      const allEuDays = entries
        .filter(
          (e) =>
            e.person_id === p &&
            e.status === "approved" &&
            inYtd(e) &&
            e.grant_id &&
            methodOf.get(e.grant_id) === "eu_daily",
        )
        .reduce((a, e) => a.plus(eligibleOf(e)), D(0))
        .div(dayHours);
      const cap = D(rules.cap_days_per_person_year);
      const share = allEuDays.gt(cap) ? cap.div(allEuDays) : D(1);
      const chargeableDays = days.mul(share);
      const overCap = days.minus(chargeableDays).mul(dayHours);
      const rate = annual.div(rules.days_per_year);
      out.set(p, {
        otherEntity: D(0),
        approved,
        eligible: eligible.minus(overCap),
        late,
        overCap,
        rate,
        unit: "day",
        direct: cents(chargeableDays.mul(rate)),
      });
    }
  }
  return out;
}

/**
 * The cost of `grant` in `period` (YYYY-MM): this period's year-to-date figure minus the previous period's.
 * `entries` must hold every entry of the people involved in that year (all grants, any status), because the
 * German hourly rate and the EU day cap depend on their other work too.
 */
export interface CostInput {
  grant: GrantRef;
  /** every grant an entry may point at (the EU day cap spans all daily-rate grants) */
  grants: GrantRef[];
  entries: Entry[];
  salaries: Salary[];
  /** person id -> employing entity */
  people: Record<string, string>;
}

export function grantPeriodCost(
  input: CostInput,
  period: string,
  cfg: GrantsConfig = grantsConfig(),
): CostResult {
  const { grant } = input;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error(`bad period ${period}`);
  const now = ytd(input, period, cfg);
  const prevPeriod = previousPeriod(period);
  const before = prevPeriod ? ytd(input, prevPeriod, cfg) : new Map<string, YtdLine>();
  const zero: YtdLine = {
    otherEntity: D(0),
    approved: D(0),
    eligible: D(0),
    late: D(0),
    overCap: D(0),
    rate: D(0),
    unit: "hour",
    direct: D(0),
  };

  const people = [...new Set([...now.keys(), ...before.keys()])].sort();
  const lines: PersonLine[] = people.map((p) => {
    const a = now.get(p) ?? { ...zero, unit: grant.method === "eu_daily" ? "day" : "hour" };
    const b = before.get(p) ?? zero;
    return {
      person_id: p,
      approved_hours: fmt(a.approved.minus(b.approved)),
      eligible_hours: fmt(a.eligible.minus(b.eligible)),
      late_hours: fmt(a.late.minus(b.late)),
      over_cap_hours: fmt(a.overCap.minus(b.overCap)),
      other_entity_hours: fmt(a.otherEntity.minus(b.otherEntity)),
      rate_eur: fmt(cents(a.rate)),
      rate_unit: a.unit,
      direct_eur: fmt(a.direct.minus(b.direct)),
    };
  });
  // Overheads and funding are computed on the year-to-date totals too, so twelve monthly amounts add up to
  // exactly what a year-end calculation gives, cent for cent.
  const totals = (m: Map<string, YtdLine>) => {
    const d = [...m.values()].reduce((s, l) => s.plus(l.direct), D(0));
    const i = cents(d.mul(grant.indirect_rate));
    return { d, i, f: cents(d.plus(i).mul(grant.funding_rate)) };
  };
  const tNow = totals(now);
  const tBefore = totals(before);
  const direct = tNow.d.minus(tBefore.d);
  const indirect = tNow.i.minus(tBefore.i);
  const funded = tNow.f.minus(tBefore.f);
  const ineligible = lines.reduce(
    (s, l) => s.plus(l.late_hours).plus(l.over_cap_hours).plus(l.other_entity_hours),
    D(0),
  );
  const contributors = lines.filter((l) => D(l.eligible_hours).gt(0)).length;
  return {
    grant_id: grant.id,
    period,
    lines,
    direct_eur: fmt(direct),
    indirect_eur: fmt(indirect),
    funded_eur: fmt(funded),
    ineligible_hours: fmt(ineligible),
    contributors,
  };
}

export { computeGrantCost, GrantNotFoundError, loadCostInput, writeSnapshot } from "./load";
