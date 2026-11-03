# Held-out set blind-1

Written blind. I read only `heldout/WRITING_CASES.md`, `docs/GRANT_RULES.md`, `config/grants.yaml`,
`docs/ACCESS.md`, `config/access.yaml` and `docs/FIXTURE.md`. I did not read or run anything under
`packages/`, `apps/`, `scripts/`, `tests/`, `infra/`, the migrations or `reports/`.

Every expected figure was computed by hand from GRANT_RULES.md, with the arithmetic in a YAML comment
next to it. Afterwards I re-checked the figures with my own small calculator (written from my reading of
GRANT_RULES.md, not from the platform). I also used a small script to expand the five long cap cases
from `@range` notes into one entry per day. As a sanity check of my reading, I worked out the three
stored fixture snapshots by hand before writing any cases: EU-LPI-26 2026-09 (1034.30 / 258.58 / 905.02),
EU-LPI-26 2026-10 (726.75 / 181.68 / 635.90) and DE-TGT-26 2026-10 (112.50 / 90.00 / 101.25).
All three match FIXTURE.md.

## Cost cases (40)

- **eu_daily**: rate = annual/215, days = hours/8, quarter hours, the rate not rounded first (3255.81, where
  rounding the rate first gives 3255.80), and the person's cost rounded half up (28.125 to 28.13).
- **Rounding**: indirect half up (103.125 to 103.13), funded half up (65.625 to 65.63), and direct as the
  sum of rounded per-person lines (56.26, not 56.25).
- **Year to date**: indirect and funded worked out on year-to-date totals and then differenced (3.12, where
  the month alone gives 3.13). January has no previous month and ignores the previous December. December
  uses its own year's record. Only the period's own hours count. A month without hours gives zero.
- **Negative adjustments**: de_hourly, where actual hours above the contract lower the rate in a month with
  no grant hours (-300.00 / -60.00 / -180.00). eu_daily, where more days on another eu_daily grant shrink
  this grant's share of the cap (-400.00 / -100.00 / -350.00).
- **de_hourly**: contract hours vs actual hours. Actual hours count draft, submitted, late, other-grant and
  no-grant hours, but not returned ones. Each count is designed so that leaving one kind out, or adding
  returned hours, changes the figure. Also covered: hours after the month are ignored, actual hours restart
  in a new year, and earlier months are re-priced when the rate drops.
- **Managing director**: capped at 75.00. Below the cap, their own rate. The cap is applied after the
  actual-hours rule (60.00 rather than 75.00).
- **215-day cap**: crossed during a month on one grant, a month entirely over the cap, shared in
  proportion across two eu_daily grants, and de_hourly grants not counting toward it.
- **Who counts**: late entries, draft/submitted/returned entries, other-entity employees with and without
  a record, a grant held by the US entity, and contributors.
- **Refusals (`missing_personnel_cost`)**: no record; a record only for another year; de_hourly; a person
  whose approved hours are only in an earlier month of the year. Also the case that must not refuse: the
  person without a record has approved hours only on another grant.

## Access cases (173)

These cover all ten fixture people and the three service principals. Every table in ACCESS.md is
included, with selects, inserts, updates and deletes, allowed and denied:

- campaigns and shots: clearance, own `lead_id`, and lead/operator membership for logging shots.
- campaign_members, targets and target_events.
- grants, work_packages, grant_members.
- time_entries (53 cases): own vs lead visibility; insert status; the 10-hour day including existing
  entries, with a boundary pair of 10 allowed and 10.25 denied; quarter hours; more than zero; no future
  dates; grant start date; closed month; membership. Owner edits of drafts and returned entries. Lead
  approve/return, never your own entry, status only, a reason for returning. Owner-only deletes of drafts.
- salary_costs: PeopleOps and Finance per entity, including the cost-snapshot job.
- cost_periods: closing a month, and no reopening.
- grant_cost_snapshots: Finance, the Executive minimum group of 3, and closed-month figures frozen.
- audit_events, outbox (Staff can add but not see; Platform principals), people, settings.

Each access case assumes the original fixture and a rolled-back transaction.

## Ambiguities and apparent errors, and how I resolved them

1. **Grant dates in cost cases.** The case format has no start/end dates for the case's grant. I assumed
   the grant covers every date used, and kept all dates before 2026-11-03 and at most 10 hours per person
   per day.
2. **Funded on rounded or unrounded indirect.** GRANT_RULES says funded = (direct + indirect) × rate, and
   indirect is "rounded to cents", so I take the rounded indirect. I chose every case's numbers so that
   both readings give the same funded amount. No case depends on this, but the documents should say.
3. **Year-to-date differencing of hours.** "Every amount for a month" is year-to-date minus the previous
   month. I applied that to `over_cap_hours` and `ineligible_hours` too. This only matters in "EU cap -
   more days on another grant later reduce this grant", where August has no hours on the grant but
   expects `over_cap_hours` 8.00 and `ineligible_hours` 8.00 (50 − 42). If hours are meant to come only
   from the month's own entries, that case expects 0.00 and the documents should say so.
4. **Eligible hours under the cap.** I read eligible hours as approved hours minus late, other-entity and
   over-cap hours, so June in the single-grant cap case shows 210.00 eligible hours, not 300.00. The
   documents define ineligible hours, but never eligible hours. In the August case above, this reading
   would give −8 eligible hours, so I left `eligible_hours` out of that line.
5. **A line for someone with no hours in the month.** "Per person, the month's line shows that month's
   hours and amounts", and direct is the sum of people's costs. A negative adjustment therefore needs a
   line even when the person worked no hours in the month. Two cases expect such a line: the de_hourly
   −300.00 case and the eu_daily −400.00 case. I also expect lines for other-entity people and late-only
   people, since their hours are "listed".
6. **Missing record for earlier-month hours.** The refusal rule says "for that grant month". I read it as
   any approved hours in the year to date, because the month's figure needs the year-to-date cost (case
   "refuses when someone's approved hours earlier in the year have no record").
7. **Missing record when all approved hours are late.** Late hours are not charged, yet the rule refuses
   for "someone with approved hours". This is unclear, so there is no case for it.
8. **Which days count toward the 215-day cap on other grants.** I assumed only approved, on-time hours of
   the person's own entity on eu_daily grants, counted per calendar year. The cases use only such hours,
   so they do not test the edges, such as submitted or late hours on another grant, or another entity's
   grant.
9. **Corrected salary "noticed" in a month.** Cost cases have one record per person per year and no
   notion of when it changed. If every year-to-date figure is recomputed from current data, a correction
   to an eu_daily salary re-prices all months instead of appearing in the month it was noticed, unless
   earlier months come from stored snapshots. This cannot be expressed in the format, so it is not tested.
10. **Returned entries: edit vs resubmit.** GRANT_RULES says "the person edits drafts and returned
    entries", but ACCESS.md requires the changed row to be draft or submitted. Editing a returned entry
    while leaving it returned is therefore denied. Cases: edit and resubmit, allowed; back to draft,
    allowed; hours change only, denied.
11. **"Returned with a reason".** I assumed a return without a note is refused (case "a lead cannot
    return an entry without a reason"). ACCESS.md does not show this rule. It would be a trigger.
12. **Grant membership for time entries.** GRANT_RULES says hours go against "a grant they are a member
    of". I assumed this is enforced (case: jan books on DE-TGT-26 and is denied). ACCESS.md has no such
    rule.
13. **Closed month vs Finance rights.** ACCESS.md lets Finance change `grant_cost_snapshots` and
    `cost_periods` without condition. GRANT_RULES says a closed month is final and its figures cannot
    change. I let GRANT_RULES win: updating the September 2026 EU snapshot and reopening September are
    both denied. A lead returning an approved September entry is denied anyway, because it is not
    submitted.
14. **Finance and entities.** GRANT_RULES says Finance sees per-person lines "for the grants of its own
    entity". ACCESS.md lets any Finance see all time entries, snapshots and the audit trail, and edit any
    grant. I followed ACCESS.md: ivo (US) sees DE entries and totals and renames a DE grant. Salary records
    stay entity-scoped. Whether ivo may close a DE grant's month is unclear, so there is no case.
15. **Outbox insert without select.** Staff may add to the outbox but not see it. If the runner inserts
    with RETURNING, PostgreSQL rejects the insert, so I expect `allowed` as documented.
16. **Service principals as `as`.** WRITING_CASES.md asks for a key from FIXTURE.md, but FIXTURE.md lists
    the service principals only by name. I used `cost-snapshot`, `dispatcher` and `reminders` as keys.
17. **Policy subqueries under row-level security.** For example, can uncleared ben add a member to his own
    restricted PHX-25-R3, whose row he cannot see? This depends on how the generated policies are written,
    so there is no case.
18. **Deleting a grant member who has time entries.** Every fixture member has entries. I expect Finance's
    delete of hana from DE-TGT-26 to be allowed, as documented. If a foreign key blocks it, the documents
    do not mention one.
19. **Target status transitions.** These are not documented. I used fabricated to characterized, a
    transition that appears in target_events.
20. **Restricted shot columns.** `energy_j`, `pulse_ns` and `notes` are restricted columns, and it is not
    documented whether an uncleared scientist may write them. I left them out of all shot inserts.
21. **Late flag depends on the run date.** Entries inserted or edited during the run may become late,
    which does not change whether the write is allowed. No expectation depends on the late flag.
22. **Period format.** I wrote `period` values in snapshots and cost periods as `"2026-09"`, matching
    FIXTURE.md. The column type is not documented.
23. **Realism of personnel cost records.** Several de_hourly cases use tiny contract hours (50 to 100) so
    that actual hours can exceed the contract with few entries. Nothing in the documents forbids this.
24. **10-hour limit and statuses.** The limit counts "all entries". My boundary cases use an approved
    entry, which is certain. Whether a returned entry counts toward the limit is not tested.
