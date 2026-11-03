import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Entry,
  type GrantRef,
  grantPeriodCost,
  MissingSalaryError,
  previousPeriod,
  type Salary,
} from "../src";

const G_DE: GrantRef = { id: "de", entity: "DE", method: "de_hourly", funding_rate: 0.5, indirect_rate: 0.8 };
const G_EU: GrantRef = { id: "eu", entity: "DE", method: "eu_daily", funding_rate: 0.7, indirect_rate: 0.25 };
const G_EU2: GrantRef = {
  id: "eu2",
  entity: "DE",
  method: "eu_daily",
  funding_rate: 0.7,
  indirect_rate: 0.25,
};
const GRANTS = [G_DE, G_EU, G_EU2];
const PEOPLE: Record<string, string> = { a: "DE", b: "DE", c: "DE", md: "DE", x: "DE", us: "US" };
const cost = (grant: GrantRef, period: string, entries: Entry[], salaries: Salary[]) =>
  grantPeriodCost({ grant, grants: GRANTS, entries, salaries, people: PEOPLE }, period);

const e = (
  person_id: string,
  grant_id: string | null,
  work_date: string,
  hours: number,
  extra: Partial<Entry> = {},
): Entry => ({
  person_id,
  grant_id,
  work_date,
  hours,
  status: "approved",
  late: false,
  ...extra,
});
const sal = (person_id: string, annual: number, contract = 1720, md = false): Salary => ({
  person_id,
  year: 2026,
  annual_cost_eur: annual,
  contract_hours: contract,
  managing_director: md,
});

describe("German cost basis (hourly rate)", () => {
  it("charges approved hours at annual cost / contract hours, then overhead and funding rate", () => {
    const r = cost(G_DE, "2026-03", [e("a", "de", "2026-03-10", 10)], [sal("a", 82000)]);
    expect(r.lines[0]).toMatchObject({ rate_eur: "47.67", rate_unit: "hour", direct_eur: "476.74" });
    expect([r.direct_eur, r.indirect_eur, r.funded_eur]).toEqual(["476.74", "381.39", "429.07"]);
    expect(r.contributors).toBe(1);
  });

  it("caps a managing director at the configured rate", () => {
    const r = cost(G_DE, "2026-10", [e("md", "de", "2026-10-16", 1.5)], [sal("md", 190000, 1720, true)]);
    expect(r.lines[0]).toMatchObject({ rate_eur: "75.00", direct_eur: "112.50" });
  });

  it("divides by actual hours once someone has worked more than the contract, and corrects in the open period", () => {
    const entries = [e("a", "de", "2026-01-15", 60), e("a", "de", "2026-02-15", 60)];
    const jan = cost(G_DE, "2026-01", entries, [sal("a", 10000, 100)]);
    const feb = cost(G_DE, "2026-02", entries, [sal("a", 10000, 100)]);
    expect(jan.direct_eur).toBe("6000.00"); // 60 h at 10,000 / 100
    expect(feb.lines[0]!.rate_eur).toBe("83.33"); // 10,000 / 120 actual hours
    expect(feb.direct_eur).toBe("4000.00"); // year to date 10,000, minus 6,000 already reported
  });

  it("counts unfunded hours as actual hours too", () => {
    const entries = [e("a", "de", "2026-05-04", 25), e("a", null, "2026-05-05", 100)];
    const r = cost(G_DE, "2026-05", entries, [sal("a", 10000, 100)]);
    expect(r.lines[0]!.rate_eur).toBe("80.00");
    expect(r.direct_eur).toBe("2000.00");
  });
});

describe("EU daily rate", () => {
  it("converts hours to days at 8 hours and charges annual cost / 215 per day", () => {
    const r = cost(G_EU, "2026-09", [e("a", "eu", "2026-09-15", 16)], [sal("a", 98000)]);
    expect(r.lines[0]).toMatchObject({ rate_eur: "455.81", rate_unit: "day", direct_eur: "911.63" });
    expect([r.indirect_eur, r.funded_eur]).toEqual(["227.91", "797.68"]); // (911.63 + 227.91) x 0.7 = 797.678
  });

  it("caps a person at 215 days a year across all daily-rate grants, shared in proportion", () => {
    const entries: Entry[] = [];
    for (let m = 1; m <= 10; m++) {
      const mm = String(m).padStart(2, "0");
      entries.push(e("a", "eu", `2026-${mm}-10`, 120), e("a", "eu2", `2026-${mm}-11`, 60));
    }
    // 1,800 h = 225 days in total; 215 / 225 of each grant's days are chargeable.
    const r = cost(G_EU, "2026-10", entries, [sal("a", 98000)]);
    const ytd = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)
      .map((p) => cost(G_EU, p, entries, [sal("a", 98000)]))
      .reduce((s, x) => s + Number(x.lines[0]!.over_cap_hours), 0);
    expect(ytd).toBeCloseTo(1200 - (1200 * 215) / 225, 1);
    expect(Number(r.lines[0]!.over_cap_hours)).toBeGreaterThan(0);
  });
});

describe("eligibility", () => {
  it("keeps late records out of the claim and reports them as ineligible hours", () => {
    const entries = [e("a", "eu", "2026-10-02", 9, { late: true }), e("a", "eu", "2026-10-14", 8)];
    const r = cost(G_EU, "2026-10", entries, [sal("a", 98000)]);
    expect(r.lines[0]).toMatchObject({ approved_hours: "17.00", eligible_hours: "8.00", late_hours: "9.00" });
    expect(r.ineligible_hours).toBe("9.00");
  });

  it("ignores hours that are not approved", () => {
    const entries = [e("a", "eu", "2026-10-14", 8, { status: "submitted" }), e("b", "eu", "2026-10-14", 8)];
    const r = cost(G_EU, "2026-10", entries, [sal("a", 98000), sal("b", 98000)]);
    expect(r.lines.map((l) => l.person_id)).toEqual(["b"]);
  });

  it("lists hours of another entity's employees separately instead of charging them as personnel cost", () => {
    const r = cost(
      G_EU,
      "2026-10",
      [e("us", "eu", "2026-10-14", 8), e("a", "eu", "2026-10-14", 8)],
      [sal("a", 98000)],
    );
    expect(r.lines.find((l) => l.person_id === "us")).toMatchObject({
      other_entity_hours: "8.00",
      direct_eur: "0.00",
    });
    expect(r.ineligible_hours).toBe("8.00");
    expect(r.contributors).toBe(1);
  });

  it("refuses to compute when a contributor has no personnel cost for the year", () => {
    expect(() => cost(G_EU, "2026-10", [e("x", "eu", "2026-10-14", 8)], [])).toThrow(MissingSalaryError);
  });

  it("counts contributors in the period, which decides whether Executive may see the total", () => {
    const entries = [
      e("a", "de", "2026-03-02", 1),
      e("b", "de", "2026-04-02", 1),
      e("c", "de", "2026-04-03", 1),
    ];
    const s = [sal("a", 80000), sal("b", 80000), sal("c", 80000)];
    expect(cost(G_DE, "2026-04", entries, s).contributors).toBe(2);
  });
});

describe("properties", () => {
  const entryArb = fc.record({
    person: fc.constantFrom("a", "b", "c"),
    grant: fc.constantFrom("de", "eu", "eu2", null),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hours: fc.integer({ min: 1, max: 40 }).map((h) => h / 4),
    status: fc.constantFrom("approved", "approved", "approved", "submitted", "returned"),
    late: fc.boolean(),
  });
  const salaries = [sal("a", 98000), sal("b", 61000, 1500), sal("c", 190000, 1720, true)];
  type Gen = typeof entryArb extends fc.Arbitrary<infer T> ? T : never;
  const toEntries = (xs: Gen[]) =>
    xs.map((x) =>
      e(
        x.person,
        x.grant,
        `2026-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`,
        x.hours,
        {
          status: x.status as Entry["status"],
          late: x.late,
        },
      ),
    );
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

  it("twelve monthly amounts add up to the year, cent for cent", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 60 }), fc.constantFrom(G_DE, G_EU), (xs, g) => {
        const entries = toEntries(xs);
        const sum = (k: "direct_eur" | "indirect_eur" | "funded_eur") =>
          months.reduce((s, p) => s + Math.round(Number(cost(g, p, entries, salaries)[k]) * 100), 0);
        // December's previous period is November, so December's year-to-date figure is the sum of all twelve.
        let ytd = { direct_eur: 0, indirect_eur: 0, funded_eur: 0 };
        let prev: string | null = "2026-12";
        const chain: string[] = [];
        while (prev) {
          chain.push(prev);
          prev = previousPeriod(prev);
        }
        ytd = chain.reduce((acc, p) => {
          const r = cost(g, p, entries, salaries);
          return {
            direct_eur: acc.direct_eur + Math.round(Number(r.direct_eur) * 100),
            indirect_eur: acc.indirect_eur + Math.round(Number(r.indirect_eur) * 100),
            funded_eur: acc.funded_eur + Math.round(Number(r.funded_eur) * 100),
          };
        }, ytd);
        expect(sum("direct_eur")).toBe(ytd.direct_eur);
        expect(sum("funded_eur")).toBe(ytd.funded_eur);
      }),
      { numRuns: 60 },
    );
  });

  it("never claims more than a person's annual cost across the grants of one method", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 80 }), (xs) => {
        const entries = toEntries(xs);
        for (const s of salaries) {
          for (const [method, grants] of [
            ["de_hourly", [G_DE]],
            ["eu_daily", [G_EU, G_EU2]],
          ] as const) {
            const total = grants
              .flatMap((g) => months.map((p) => cost(g, p, entries, salaries)))
              .flatMap((r) => r.lines.filter((l) => l.person_id === s.person_id))
              .reduce((a, l) => a + Number(l.direct_eur), 0);
            expect(total, `${method} ${s.person_id}`).toBeLessThanOrEqual(Number(s.annual_cost_eur) + 0.05);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("the funded amount never exceeds direct plus indirect cost", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), fc.constantFrom(...months), (xs, p) => {
        const r = cost(G_EU, p, toEntries(xs), salaries);
        const ytdTotal = Number(r.direct_eur) + Number(r.indirect_eur);
        if (ytdTotal >= 0) expect(Number(r.funded_eur)).toBeLessThanOrEqual(ytdTotal + 0.01);
      }),
      { numRuns: 60 },
    );
  });
});
