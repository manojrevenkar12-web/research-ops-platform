// Named people and data used by the tests, the access proof and the local demo. Every rule in
// config/access.yaml needs at least one row here that only it lets someone see or change, or the access
// proof cannot tell the rule is there; the policy mutants check exactly that.
import type { Principal } from "@rop/access";
import { accessModel } from "@rop/access";
import { grantPeriodCost } from "@rop/costs";
import type pg from "pg";

const uid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${group.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;

export interface Persona extends Principal {
  key: string;
  name: string;
  email: string;
  team: string;
  oid: string;
}

const P = (n: number, key: string, name: string, entity: string, team: string, roles: string[]): Persona => ({
  key,
  name,
  label: name,
  personId: uid(1, n),
  oid: uid(9, n),
  email: `${key}@example.com`,
  entity,
  team,
  roles: ["Staff", ...roles],
});

export const PERSONAS = {
  ana: P(1, "ana", "Ana Weber", "DE", "Experimental Physics", ["Scientist", "RestrictedTechnical"]),
  ben: P(2, "ben", "Ben Okafor", "DE", "Experimental Physics", ["Scientist"]),
  cleo: P(3, "cleo", "Cleo Martin", "US", "Target Fabrication", ["Scientist", "RestrictedTechnical"]),
  dan: P(4, "dan", "Dan Fischer", "DE", "Finance", ["Finance"]),
  eva: P(5, "eva", "Eva Schulz", "DE", "People", ["PeopleOps"]),
  finn: P(6, "finn", "Finn Carter", "US", "People", ["PeopleOps"]),
  gus: P(7, "gus", "Gus Lehmann", "DE", "Management", ["Executive"]),
  hana: P(8, "hana", "Hana Yilmaz", "DE", "Legal", []),
  ivo: P(9, "ivo", "Ivo Petrov", "US", "Finance", ["Finance"]),
  jan: P(10, "jan", "Jan Becker", "DE", "Experimental Physics", ["Scientist"]),
} satisfies Record<string, Persona>;

/** Scheduled jobs act as these principals; their roles come from config/access.yaml. */
export function servicePrincipal(name: string): Principal {
  const sp = accessModel().service_principals[name];
  if (!sp) throw new Error(`unknown service principal ${name}`);
  const n = Object.keys(accessModel().service_principals).indexOf(name) + 1;
  return { personId: uid(2, n), roles: sp.roles, entity: sp.entity, label: `service:${name}` };
}

export const ID = {
  c1: uid(3, 1), // restricted, DE, led by Ana
  c2: uid(3, 2), // internal, DE, led by Ben
  c3: uid(3, 3), // internal, US, led by Cleo
  c4: uid(3, 4), // internal, led by Hana, who moved from the lab to Legal and is no longer a Scientist
  c5: uid(3, 5), // restricted, led by Ben, whose clearance has since lapsed
  t: (n: number) => uid(4, n),
  shot: (n: number) => uid(5, n),
  g1: uid(6, 1), // EU daily-rate grant
  g2: uid(6, 2), // German cost-basis grant
  wp: (n: number) => uid(7, n),
  te: (n: number) => uid(8, n),
};

const { ana, ben, cleo, dan, gus, hana, ivo, jan } = PERSONAS;

export const FIXTURE = {
  people: Object.values(PERSONAS).map((p) => ({
    id: p.personId,
    entra_oid: p.oid,
    display_name: p.name,
    email: p.email,
    entity: p.entity,
    team: p.team,
    active: true,
  })),
  campaigns: [
    {
      id: ID.c1,
      code: "PHX-26-R1",
      title: "Proton beam conversion, restricted",
      facility: "Partner laser facility A",
      entity: "DE",
      classification: "restricted",
      lead_id: ana.personId,
      starts_on: "2026-09-01",
      ends_on: "2026-12-18",
    },
    {
      id: ID.c2,
      code: "PHX-26-I2",
      title: "Target alignment study",
      facility: "Darmstadt lab",
      entity: "DE",
      classification: "internal",
      lead_id: ben.personId,
      starts_on: "2026-10-05",
      ends_on: null,
    },
    {
      id: ID.c4,
      code: "PHX-25-I9",
      title: "Debris shield coating trial",
      facility: "Darmstadt lab",
      entity: "DE",
      classification: "internal",
      lead_id: hana.personId,
      starts_on: "2025-03-03",
      ends_on: "2025-06-27",
    },
    {
      id: ID.c5,
      code: "PHX-25-R3",
      title: "Pre-pulse contrast measurement",
      facility: "Partner laser facility A",
      entity: "DE",
      classification: "restricted",
      lead_id: ben.personId,
      starts_on: "2025-05-12",
      ends_on: "2025-07-04",
    },
    {
      id: ID.c3,
      code: "AUS-26-T1",
      title: "Target survival under rep-rated shots",
      facility: "Austin lab",
      entity: "US",
      classification: "internal",
      lead_id: cleo.personId,
      starts_on: "2026-10-12",
      ends_on: null,
    },
  ],
  campaign_members: [
    { campaign_id: ID.c1, person_id: ana.personId, role: "lead" },
    { campaign_id: ID.c1, person_id: cleo.personId, role: "operator" },
    { campaign_id: ID.c1, person_id: ben.personId, role: "observer" },
    { campaign_id: ID.c2, person_id: ben.personId, role: "lead" },
    { campaign_id: ID.c2, person_id: ana.personId, role: "operator" },
    { campaign_id: ID.c3, person_id: cleo.personId, role: "lead" },
    { campaign_id: ID.c4, person_id: hana.personId, role: "lead" },
    { campaign_id: ID.c4, person_id: ben.personId, role: "operator" },
  ],
  targets: [
    {
      id: ID.t(1),
      serial: "TGT-0001",
      batch: "B-0926",
      design: "CH foil 10 µm",
      status: "shot",
      campaign_id: ID.c1,
    },
    {
      id: ID.t(2),
      serial: "TGT-0002",
      batch: "B-0926",
      design: "CH foil 10 µm",
      status: "allocated",
      campaign_id: ID.c1,
    },
    {
      id: ID.t(3),
      serial: "TGT-0003",
      batch: "B-0926",
      design: "CH foil 10 µm",
      status: "allocated",
      campaign_id: ID.c2,
    },
    {
      id: ID.t(4),
      serial: "TGT-0004",
      batch: "B-1003",
      design: "Cu foil 5 µm",
      status: "characterized",
      campaign_id: null,
    },
    {
      id: ID.t(5),
      serial: "TGT-0005",
      batch: "B-1003",
      design: "Cu foil 5 µm",
      status: "fabricated",
      campaign_id: null,
    },
    {
      id: ID.t(6),
      serial: "TGT-0006",
      batch: "B-1003",
      design: "Cu foil 5 µm",
      status: "scrapped",
      campaign_id: null,
    },
    {
      id: ID.t(7),
      serial: "TGT-0007",
      batch: "B-1010",
      design: "CD shell 400 µm",
      status: "shot",
      campaign_id: ID.c2,
    },
    {
      id: ID.t(8),
      serial: "TGT-0008",
      batch: "B-1010",
      design: "CD shell 400 µm",
      status: "allocated",
      campaign_id: ID.c3,
    },
  ],
  shots: [
    {
      id: ID.shot(1),
      campaign_id: ID.c1,
      shot_no: 1,
      fired_at: "2026-10-01T09:12:00Z",
      target_id: ID.t(1),
      energy_j: 41.2,
      pulse_ns: 0.8,
      outcome: "nominal",
      notes: "Proton spectrum recorded on both spectrometers; conversion efficiency estimate pending.",
      classification: "restricted",
      logged_by: ana.personId,
      corrects: null,
    },
    {
      id: ID.shot(2),
      campaign_id: ID.c1,
      shot_no: 2,
      fired_at: "2026-10-01T11:40:00Z",
      target_id: null,
      energy_j: 12.5,
      pulse_ns: 0.8,
      outcome: "aborted",
      notes: "Interlock tripped during charge; no shot on target.",
      classification: "restricted",
      logged_by: cleo.personId,
      corrects: null,
    },
    {
      id: ID.shot(3),
      campaign_id: ID.c1,
      shot_no: 2,
      fired_at: "2026-10-01T11:40:00Z",
      target_id: null,
      energy_j: 0,
      pulse_ns: 0.8,
      outcome: "aborted",
      notes: "Correction: no energy delivered; interlock tripped at 80 percent charge.",
      classification: "restricted",
      logged_by: ana.personId,
      corrects: ID.shot(2),
    },
    {
      id: ID.shot(4),
      campaign_id: ID.c2,
      shot_no: 1,
      fired_at: "2026-10-14T10:05:00Z",
      target_id: ID.t(7),
      energy_j: 3.1,
      pulse_ns: 1.2,
      outcome: "nominal",
      notes: "Alignment within 6 µm of the reference; camera saturated on frame 3.",
      classification: "internal",
      logged_by: ben.personId,
      corrects: null,
    },
    {
      id: ID.shot(5),
      campaign_id: ID.c2,
      shot_no: 2,
      fired_at: "2026-10-14T13:30:00Z",
      target_id: null,
      energy_j: 2.9,
      pulse_ns: 1.2,
      outcome: "partial",
      notes: "Timing jitter on the diagnostic trigger; alignment data usable.",
      classification: "internal",
      logged_by: ana.personId,
      corrects: null,
    },
    {
      id: ID.shot(6),
      campaign_id: ID.c3,
      shot_no: 1,
      fired_at: "2026-10-20T16:00:00Z",
      target_id: null,
      energy_j: 1.0,
      pulse_ns: 2.0,
      outcome: "misfire",
      notes: "Pockels cell did not fire; check the delay generator.",
      classification: "internal",
      logged_by: cleo.personId,
      corrects: null,
    },
  ],
  grants: [
    {
      id: ID.g1,
      code: "EU-LPI-26",
      title: "Laser-plasma interaction for fast ignition",
      funder: "European Commission (EIC)",
      method: "eu_daily",
      entity: "DE",
      starts_on: "2026-01-01",
      ends_on: "2028-12-31",
      funding_rate: 0.7,
      indirect_rate: 0.25,
    },
    {
      id: ID.g2,
      code: "DE-TGT-26",
      title: "Mass production of fusion targets",
      funder: "Federal ministry (cost basis)",
      method: "de_hourly",
      entity: "DE",
      starts_on: "2026-04-01",
      ends_on: "2027-12-31",
      funding_rate: 0.5,
      indirect_rate: 0.8,
    },
  ],
  work_packages: [
    { id: ID.wp(1), grant_id: ID.g1, code: "WP1", title: "Experiments" },
    { id: ID.wp(2), grant_id: ID.g1, code: "WP2", title: "Simulation and analysis" },
    { id: ID.wp(3), grant_id: ID.g2, code: "WP1", title: "Fabrication process" },
  ],
  grant_members: [
    { grant_id: ID.g1, person_id: ana.personId, role: "lead" },
    { grant_id: ID.g1, person_id: ben.personId, role: "member" },
    { grant_id: ID.g1, person_id: cleo.personId, role: "member" },
    { grant_id: ID.g1, person_id: jan.personId, role: "member" },
    { grant_id: ID.g2, person_id: ben.personId, role: "lead" },
    { grant_id: ID.g2, person_id: ana.personId, role: "member" },
    { grant_id: ID.g2, person_id: hana.personId, role: "member" },
    { grant_id: ID.g2, person_id: gus.personId, role: "member" },
  ],
  time_entries: [
    // September (G1's September is closed)
    {
      id: ID.te(1),
      person_id: ana.personId,
      work_date: "2026-09-15",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Shot campaign preparation",
      hours: 6,
      status: "approved",
      approved_by: ben.personId,
      approved_at: "2026-09-16T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(2),
      person_id: ben.personId,
      work_date: "2026-09-15",
      work_package_id: ID.wp(2),
      grant_id: ID.g1,
      activity: "PIC simulation runs",
      hours: 7.5,
      status: "approved",
      approved_by: ana.personId,
      approved_at: "2026-09-16T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(3),
      person_id: cleo.personId,
      work_date: "2026-09-16",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Diagnostics calibration",
      hours: 8,
      status: "approved",
      approved_by: ana.personId,
      approved_at: "2026-09-17T08:00:00Z",
      late: false,
    },
    // October, open periods
    {
      id: ID.te(4),
      person_id: ben.personId,
      work_date: "2026-10-14",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Alignment shots",
      hours: 5,
      status: "submitted",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(5),
      person_id: cleo.personId,
      work_date: "2026-10-20",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Target survival tests",
      hours: 4,
      status: "draft",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(6),
      person_id: ana.personId,
      work_date: "2026-10-14",
      work_package_id: ID.wp(3),
      grant_id: ID.g2,
      activity: "Fabrication review",
      hours: 2,
      status: "submitted",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(7),
      person_id: hana.personId,
      work_date: "2026-10-15",
      work_package_id: ID.wp(3),
      grant_id: ID.g2,
      activity: "Supplier contract for target material",
      hours: 3,
      status: "returned",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(8),
      person_id: ben.personId,
      work_date: "2026-10-15",
      work_package_id: ID.wp(3),
      grant_id: ID.g2,
      activity: "Process review",
      hours: 2,
      status: "submitted",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(9),
      person_id: gus.personId,
      work_date: "2026-10-16",
      work_package_id: ID.wp(3),
      grant_id: ID.g2,
      activity: "Steering committee",
      hours: 1.5,
      status: "approved",
      approved_by: ben.personId,
      approved_at: "2026-10-17T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(10),
      person_id: dan.personId,
      work_date: "2026-10-16",
      work_package_id: null,
      grant_id: null,
      activity: "Month-end close",
      hours: 8,
      status: "draft",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(13),
      person_id: jan.personId,
      work_date: "2026-09-17",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Diagnostics alignment",
      hours: 8,
      status: "approved",
      approved_by: ana.personId,
      approved_at: "2026-09-18T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(14),
      person_id: jan.personId,
      work_date: "2026-10-07",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Shot campaign",
      hours: 6,
      status: "approved",
      approved_by: ana.personId,
      approved_at: "2026-10-08T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(15),
      person_id: ben.personId,
      work_date: "2026-10-08",
      work_package_id: ID.wp(2),
      grant_id: ID.g1,
      activity: "PIC simulation runs",
      hours: 4,
      status: "approved",
      approved_by: ana.personId,
      approved_at: "2026-10-09T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(16),
      person_id: ana.personId,
      work_date: "2026-10-09",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Shot campaign",
      hours: 5,
      status: "approved",
      approved_by: ben.personId,
      approved_at: "2026-10-10T08:00:00Z",
      late: false,
    },
    {
      id: ID.te(12),
      person_id: ana.personId,
      work_date: "2026-10-19",
      work_package_id: ID.wp(2),
      grant_id: ID.g1,
      activity: "Spectrum analysis",
      hours: 3,
      status: "draft",
      approved_by: null,
      approved_at: null,
      late: false,
    },
    {
      id: ID.te(11),
      person_id: ana.personId,
      work_date: "2026-10-02",
      work_package_id: ID.wp(1),
      grant_id: ID.g1,
      activity: "Shot campaign",
      hours: 9,
      status: "approved",
      approved_by: ben.personId,
      approved_at: "2026-10-03T08:00:00Z",
      late: true,
    },
  ],
  salary_costs: [
    {
      person_id: ana.personId,
      entity: "DE",
      year: 2026,
      annual_cost_eur: 98000,
      contract_hours: 1720,
      managing_director: false,
    },
    {
      person_id: ben.personId,
      entity: "DE",
      year: 2026,
      annual_cost_eur: 82000,
      contract_hours: 1720,
      managing_director: false,
    },
    {
      person_id: hana.personId,
      entity: "DE",
      year: 2026,
      annual_cost_eur: 76000,
      contract_hours: 1560,
      managing_director: false,
    },
    {
      person_id: gus.personId,
      entity: "DE",
      year: 2026,
      annual_cost_eur: 190000,
      contract_hours: 1720,
      managing_director: true,
    },
    {
      person_id: cleo.personId,
      entity: "US",
      year: 2026,
      annual_cost_eur: 118000,
      contract_hours: 2080,
      managing_director: false,
    },
    {
      person_id: ivo.personId,
      entity: "US",
      year: 2026,
      annual_cost_eur: 101000,
      contract_hours: 2080,
      managing_director: false,
    },
    {
      person_id: jan.personId,
      entity: "DE",
      year: 2026,
      annual_cost_eur: 72000,
      contract_hours: 1720,
      managing_director: false,
    },
  ],
  cost_periods: [
    {
      grant_id: ID.g1,
      period: "2026-09",
      status: "closed",
      closed_at: "2026-10-05T12:00:00Z",
      closed_by: dan.personId,
    },
    { grant_id: ID.g1, period: "2026-10", status: "open", closed_at: null, closed_by: null },
    { grant_id: ID.g2, period: "2026-10", status: "open", closed_at: null, closed_by: null },
  ],
  grant_cost_snapshots: [] as Record<string, unknown>[], // computed below by the cost engine
  target_events: [
    {
      id: 1,
      target_id: ID.t(4),
      from_status: "fabricated",
      to_status: "characterized",
      by_person: cleo.personId,
      note: "",
    },
    {
      id: 2,
      target_id: ID.t(6),
      from_status: "fabricated",
      to_status: "scrapped",
      by_person: cleo.personId,
      note: "Cracked during mounting",
    },
  ],
  audit_events: [
    {
      id: 1,
      actor: dan.personId,
      table_name: "cost_periods",
      row_id: `${ID.g1}/2026-09`,
      action: "update",
      change: { status: { old: "open", new: "closed" } },
    },
  ],
  outbox: [{ id: 1, topic: "time.reminder", payload: { person_id: hana.personId, week: "2026-W42" } }],
};

// The reported figures are what the cost engine computes from the rows above, not invented numbers.
FIXTURE.grant_cost_snapshots = (
  [
    [ID.g1, "2026-09"],
    [ID.g1, "2026-10"],
    [ID.g2, "2026-10"],
  ] as const
).map(([grantId, period]) => {
  const grants = FIXTURE.grants.map((g) => ({
    id: g.id,
    method: g.method as "eu_daily" | "de_hourly",
    entity: g.entity,
    funding_rate: g.funding_rate,
    indirect_rate: g.indirect_rate,
  }));
  const r = grantPeriodCost(
    {
      grant: grants.find((g) => g.id === grantId)!,
      grants,
      entries: FIXTURE.time_entries.map((e) => ({ ...e, status: e.status as "approved" })),
      salaries: FIXTURE.salary_costs,
      people: Object.fromEntries(FIXTURE.people.map((p) => [p.id, p.entity])),
    },
    period,
  );
  return {
    grant_id: grantId,
    period,
    direct_eur: r.direct_eur,
    indirect_eur: r.indirect_eur,
    funded_eur: r.funded_eur,
    ineligible_hours: r.ineligible_hours,
    contributors: r.contributors,
  };
});

export const TABLE_ORDER = [
  "people",
  "campaigns",
  "campaign_members",
  "targets",
  "target_events",
  "shots",
  "grants",
  "work_packages",
  "grant_members",
  "time_entries",
  "salary_costs",
  "cost_periods",
  "grant_cost_snapshots",
  "audit_events",
  "outbox",
] as const;

/**
 * Load the fixture as the schema owner with triggers off (a historical import): the rows describe a past
 * state, e.g. hours recorded on time in September, which the triggers would stamp with today's date.
 */
export async function loadFixture(
  admin: pg.ClientBase,
  data: Partial<typeof FIXTURE> = FIXTURE,
): Promise<void> {
  await admin.query("BEGIN");
  try {
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of TABLE_ORDER) {
      const rows = (data as Record<string, Record<string, unknown>[] | undefined>)[table];
      if (!rows?.length) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        const values = cols.map((c) => {
          const v = row[c];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        await admin.query(
          `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          values,
        );
      }
    }
    for (const seq of ["audit_events_id_seq", "outbox_id_seq", "target_events_id_seq"]) {
      await admin.query(`SELECT setval('public.${seq}', 1000)`);
    }
    await admin.query("COMMIT");
  } catch (err) {
    await admin.query("ROLLBACK");
    throw err;
  }
}
