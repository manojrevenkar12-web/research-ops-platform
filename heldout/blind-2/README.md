# Held-out set blind-2

Written without reading the implementation, the tests, the migrations or `heldout/blind-1`. The only sources
were `heldout/WRITING_CASES.md`, `docs/GRANT_RULES.md`, `config/grants.yaml`, `docs/ACCESS.md`,
`config/access.yaml` and `docs/FIXTURE.md`. No platform code, test or database command was run.

- `cases.yaml`: 44 cost cases and 222 access cases.
- `STATUS`: `heldout`.

## How the numbers were made

Every expected amount was worked out by hand from `docs/GRANT_RULES.md`, and the arithmetic is in the
comment next to it. I then checked the arithmetic with a small calculator script of my own, kept in my
scratch directory outside the project. It never imports or touches the project. It found no differences.
The six 215-day-cap cases need more than 1720 hours in a year at no more than 10 hours a day, so their
entry lists (one entry per calendar day) were expanded by a small script from one-line ranges. Each day
holds at most 10 hours for a person, every entry is a whole number of quarter hours, and no date is in the
future.

As a sanity check of my reading, I recomputed the fixture's own `grant_cost_snapshots` rows from the
fixture entries and salaries. All three match (EU-LPI-26 2026-09: 1034.30 / 258.58 / 905.02 / 8.00 / 3;
2026-10: 726.75 / 181.68 / 635.90 / 9.00 / 3; DE-TGT-26 2026-10: 112.50 / 90.00 / 101.25 / 0.00 / 1).
The October figure 726.75 only comes out if each person's cost is rounded year to date and then
differenced. Rounding each month on its own gives 726.74 (jan: 586.05 - 334.88 = 251.17, not 251.16).
That supports the reading used in the year-to-date cases below.

## What the cost cases cover

| Rule | Cases |
|---|---|
| `eu_daily` rate /215, 8 h per day, rate not rounded first | one person; 10 days at 465.116...; 8 h/day ignores contract and actual hours |
| `de_hourly` rate, quarter hours, rate not rounded first | one person; 56.976... rate; two people at different rates |
| Rounding: person line half up, indirect and funded half up, lines rounded before summing | 62.505 -> 62.51; 250.025 -> 250.03 and 625.065 -> 625.07; 590.625 -> 590.63; 3 x 14.53 and 3 x 14.24 lines |
| Managing director cap | capped (110.47 -> 75); below cap (60); cap applied after dividing by actual hours; no cap on `eu_daily` |
| Contract vs actual hours | drafts on no grant count; returned do not; submitted hours on another grant and late hours count; hours after the month do not; the previous year does not |
| Year to date, adjustments, negative months | the rate falls in February (+1000.00); negative month (-1500.00 / -300.00 / -900.00, 0 contributors); indirect/funded rounded on YTD then differenced; eu_daily person cost rounded on YTD then differenced; earlier and later months excluded |
| January | December entries ignored, the year's own personnel cost used; actual hours of the previous year ignored |
| Late entries | `eu_daily` and `de_hourly`: shown as `late_hours`, ineligible, not charged |
| Statuses | only approved count; no approved hours gives zeros and 0 contributors |
| Other entities | US employee on a DE grant (no record needed); DE employee on a US de_hourly grant |
| Contributors and ineligible hours | 5 people: late-only, draft-only and other-entity people are not contributors; ineligible = late + other-entity |
| Missing personnel cost | no record; record only for the previous year; no refusal for a person with only unapproved hours, or with approved hours only on another grant |
| 215-day cap | one grant in the month it is reached (90 h over); the month after (20 h over, 0.00 direct); two eu_daily grants kept in proportion (44 x 215/220 = 43 days); de_hourly days, late days and last year's days do not count toward the cap |

## What the access cases cover

Every role (Staff only: hana; Scientist with and without RestrictedTechnical; Finance DE and US; PeopleOps
DE and US; Executive) and all three service principals (`cost-snapshot`, `reminders`, `dispatcher`), on every
table of `docs/ACCESS.md`, with select, insert, update and delete where the table allows or forbids them:

- `people`, `target_events`, `settings`, `audit_events`: read-only through the app (inserts, updates and
  deletes denied even for Finance or PeopleOps); `audit_events` visible to Finance only (DE and US).
- `campaigns`: clearance, own-lead visibility for non-scientists, insert/update checks (own lead, cleared),
  no hand-over, no delete.
- `campaign_members`, `shots`, `targets`: lead-only membership changes; shots need own + cleared +
  lead/operator membership, are append-only, and corrections are new rows; targets inserted only as
  fabricated.
- `grants`, `work_packages`, `grant_members`, `cost_periods`: Finance writes, nobody deletes (except
  grant members).
- `time_entries` (80 cases): visibility (own, lead of that grant only, Finance), recording rules (own
  person, draft/submitted only, quarter hours, more than 0, the 10-hour daily limit including existing
  draft, submitted and late approved entries, no future date, not before the grant starts, membership,
  closed month of that grant only), the lead's decisions (approve; return with a `return_reason` of at
  least 3 characters; never their own; only submitted entries; nothing else changed; not on another grant;
  not by plain members, Finance or Executive), owner edits (drafts and returned entries, the return reason
  untouchable, no self-approval, closed month, daily limit on update), deletes (own drafts only).
- `salary_costs`: entity of the personnel cost for PeopleOps, Finance and the DE `cost-snapshot`
  principal; nobody sees their own; inserts and updates only within the entity; no delete.
- `grant_cost_snapshots`: Finance; Executive only with at least 3 contributors (3 visible, 1 hidden);
  closed-month figures cannot change; no delete.
- `outbox`: Staff and Platform insert, Platform reads and updates, nobody deletes.

## Ambiguities and apparent errors in the documents

1. **Over-cap hours and "eligible" hours.** The cap applies to "year-to-date eligible days", so eligible
   seems to mean before the cap. Yet "Ineligible hours = late + over-cap + other-entity" treats over-cap
   hours as not eligible. So a person's `eligible_hours` line (and so "contributors") could be read either
   before or after the cap. The capped cases leave out `eligible_hours`. Contributors appear only where
   both readings give the same answer.
2. **Month figures for hours.** "Every amount for a month is the year-to-date figure ... minus the
   previous" is clear for money but does not say whether `over_cap_hours` is differenced too. I took it as
   differenced ("the month's line shows that month's hours"). The month-after-cap case expects 20 h,
   which is July's hours. Across several grants, proportional reduction can move over-cap hours onto a
   grant in a month when it had no hours, or make a month's over-cap negative. Those situations are not
   tested.
3. **Person cost rounding with year to date.** The rules round "each person's cost to cents" and also say
   that every amount is a year-to-date difference. I read this as rounding the person's YTD cost and then
   differencing it, so a month can differ by a cent from rounding the month alone. The fixture snapshot
   confirms this (see above), and one case tests it (14.54, not 14.53).
4. **Half-up for person lines.** GRANT_RULES.md says "half up" only for indirect and funded. For the person's
   cost it says just "rounded to cents". `config/grants.yaml` (`money.rounding: half_up_cents`) settles it as
   half up (62.505 -> 62.51).
5. **Managing-director cap on `eu_daily`.** The 75 EUR/h cap sits under the `de_hourly` heading in both
   documents, so I tested that it does not apply to `eu_daily`. The documents never say so outright.
6. **Missing personnel cost when the only approved hours are late,** or when approved hours lie only in
   earlier months of the year. The literal rule ("someone with approved hours on a grant has no record")
   would refuse. But late hours are never charged, and earlier months are only needed for the YTD
   subtraction. Not tested.
7. **Late unapproved entries.** It is not said whether a late draft or submitted entry counts in
   `late_hours`. Every late entry in the cases is approved.
8. **Grant dates in cost cases.** The case format has no grant start or end date, yet hours outside them
   are refused. I assumed the harness makes each case's grants cover all its entry dates (some cases use
   2025 dates and December 2025).
9. **Actual hours by date.** "Recorded in that year up to the end of the month" was read as by work date,
   not by `recorded_at`.
10. **Owner edits of returned entries.** GRANT_RULES.md says "the person edits drafts and returned
    entries". ACCESS.md requires the changed row to be `draft` or `submitted`, so an owner cannot leave an
    edited entry `returned`. I followed ACCESS.md: changing only the note of a returned entry is
    expected `denied`, while reworking it to draft or resubmitting it is `allowed`.
11. **An uncleared lead and their restricted campaign.** The campaigns update rule's `using` has only
    `own: lead_id` and no clearance. Under the policy alone, ben (no clearance) could set his restricted
    PHX-25-R3 to `internal`, because the new row is internal and passes the check. But PostgreSQL also
    applies the SELECT policies when an UPDATE has a WHERE clause, and those hide the row from him. The
    outcome depends on the implementation and looks like a gap in the model (declassification without
    clearance), so it is not tested. Retitling it is tested as denied, which holds either way.
12. **Subqueries under row-level security.** The `campaign_members` insert check looks up `campaigns`. If
    that lookup is itself filtered, ben cannot add members to his own restricted PHX-25-R3. If it is not
    filtered, he can. Not tested.
13. **Shots insert wording.** ACCESS.md renders the rule as "own and internal, or RestrictedTechnical and
    lead/operator", which reads as an OR of two pairs. `config/access.yaml` shows three conditions that
    must all hold (own; cleared; lead/operator). I used the YAML. The observer case (ben, an internal shot
    in PHX-26-R1) is denied under either reading.
14. **Finance and entities.** GRANT_RULES.md says Finance sees per-person lines "for the grants of its own
    entity" and "nobody else sees personnel costs". `config/access.yaml` gives Finance unconditional
    select on `time_entries`, `grant_cost_snapshots` and `audit_events`, and unconditional update on
    `grants` and `cost_periods`. Since ACCESS.md says the database enforces exactly that, I expect US
    Finance (ivo) to see DE entries, DE snapshots and audit events, and to change a DE grant's title.
    Whether ivo may close a DE grant's month ("Finance ... closes months" of its own entity?) is unclear
    and not tested.
15. **Reopening a closed month.** Finance may update `cost_periods`, but a closed month "is final". Whether
    setting it back to open is refused is not stated. Not tested.
16. **Closed-month figures and rate or salary changes.** "Its figures cannot change" is tested as Finance
    being unable to update the September snapshot (ACCESS.md alone would allow it). Changing a grant's
    rates or a salary would change recomputed figures of a closed month. The rules say a corrected salary
    shows up as an adjustment later, so salary updates are expected to be allowed. The tested one is for
    hana, who has no hours in a closed month. Rate changes on EU-LPI-26 are not tested.
17. **Entity of a personnel cost versus the person's employer.** RLS checks only the row's `entity`
    column, so DE PeopleOps might record a DE cost for a US employee. Whether something prevents this is
    not documented. Not tested.
18. **Daily limit and returned entries.** "Across all entries" was read as including draft, submitted and
    approved (also late) entries, which is tested. Whether a returned entry still counts is unclear and not
    tested.
19. **Membership when recording.** "Optionally against a work package of a grant they are a member of"
    was read as enforced: hana recording on EU-LPI-26 is denied. A work package of one grant combined with
    another grant's id is not tested.
20. **Closing a month with undecided entries, and removing a member who has entries.** Neither is mentioned.
    I assumed both are allowed (Finance closes DE-TGT-26 October although it still has submitted and
    returned entries; Finance removes gus from DE-TGT-26).
21. **Settings rows.** FIXTURE.md lists no `settings` rows, so there is no select case. The update and
    delete cases on `min_group_size` are `denied` whether or not the row exists, so they are weaker
    checks.
22. **Inserts on tables the inserter cannot read** (`outbox` for Staff). These are expected `allowed`, as
    ACCESS.md says. A harness that inserts with RETURNING would need the row to be visible.
23. **Editing an October entry now marks it late.** Changing the date or hours more than 7 days after the
    day worked makes the entry late. I assumed this only flags the entry and does not refuse the change
    ("late entries stay in the record").
