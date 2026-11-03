# Grant time recording and personnel-cost rules

What the grants app enforces and computes, in words a finance colleague can check. The numbers live in
`config/grants.yaml`; this document explains them. These rules model two common cost methods; they are not
legal advice, and each grant's agreement or funding notice decides (Finance owns the configuration).

## Recording hours

- People record their own hours per day, optionally against a work package of a grant they are a member of.
  Hours are in quarter hours, more than 0 and at most 24 per entry.
- At most **10 hours per person per day** across all entries (Arbeitszeitgesetz, § 3). The limit holds when
  entries arrive at the same moment.
- No hours for a future date, and no hours on a grant outside the grant's start and end dates.
- An entry is **late** when it is recorded (or its date, hours or work package last changed) more than
  **7 days** after the day worked. Late entries stay in the record and are shown, but are **not charged** to a
  grant. Funders expect time records made as the work happens, not reconstructed later.
- Life of an entry: `draft` → `submitted` → `approved` by a lead of that grant, or `returned` with a reason.
  The reason (at least 3 characters) is kept on the entry in `return_reason`, separate from the person's own
  `note`, until the entry is decided again; the person sees it and cannot change it.
  The person edits drafts and returned entries; a lead can only decide (approve or return) someone else's
  submitted entry and cannot change anything else; nobody approves their own hours.
- Only **approved** entries count for costs.
- A **closed** month of a grant is final: no entry of that grant and month can be added, changed or deleted,
  by anyone, and its figures cannot change.

## Who counts

Only employees of the entity that holds the grant are personnel costs of that grant. Approved hours of
someone employed by another entity are listed as `other_entity_hours`, are not charged, and do not need a
personnel cost record.

## Methods

Each grant uses one method. In both, a person's **annual personnel cost** (`annual_cost_eur`: gross salary
plus employer contributions) and **contract hours per year** come from the personnel cost record of that year.
If someone with approved hours on a grant has no record for the year, the computation refuses to produce
figures for that grant month (it does not guess).

### `eu_daily`: daily rate (Horizon Europe style)

- Daily rate = annual personnel cost / **215**.
- Hours are converted to days at **8 hours per day** (day-equivalent).
- A person can be charged at most **215 days per year in total across all `eu_daily` grants**. If their
  year-to-date eligible days across those grants exceed 215, each grant's days are reduced in the same
  proportion (each grant keeps days × 215 / total days) and the removed days, converted back to hours at 8 hours
  per day, are reported as `over_cap_hours`.
- Person's cost = chargeable days × daily rate, rounded to cents (the rate itself is not rounded first).

### `de_hourly`: hourly rate on a cost basis (German style)

- Hourly rate = annual personnel cost / the larger of **contract hours** and **actual hours**, where actual
  hours are all hours the person recorded in that year up to the end of the month being computed (on any grant
  or none, in any status except returned).
- A **managing director** is charged at most **75.00 EUR per hour**.
- Person's cost = eligible approved hours × hourly rate, rounded to cents (the rate itself is not rounded first).

## From people to the grant

- **Direct** cost = sum of the people's costs (each already rounded to cents).
- **Indirect** cost = direct × the grant's `indirect_rate` (for example 25 % flat rate for EU grants, the
  company's overhead rate for German cost-basis grants), rounded to cents, half up.
- **Funded** amount = (direct + indirect) × the grant's `funding_rate`, rounded to cents, half up.
- **Ineligible hours** = late hours + over-cap hours + other-entity hours.
- **Contributors** = the number of people with eligible hours greater than zero in that month.

## Months and corrections

Figures are computed **year to date**: every amount for a month is the year-to-date figure at the end of that
month minus the year-to-date figure at the end of the previous month (January has no previous month).
Indirect and funded amounts are also computed on year-to-date totals and then differenced. So twelve monthly
amounts add up to the year exactly, and a rate that changes during the year (someone working more hours than
their contract, a corrected salary) appears as an adjustment in the month it is noticed. An amount for a month
can therefore be negative. Per person, the month's line shows that month's hours and amounts and the current
rate.

## Who sees the figures

- Finance sees the per-person lines (with rates) for the grants of its own entity and closes months.
- Executive sees monthly grant totals only when at least **3** people contributed: a total over one or two
  people is their pay.
- Nobody else sees personnel costs.

## Sources

- Horizon Europe personnel costs (daily rate = annual personnel costs / 215; day-equivalent options; 215-day
  cap): Annotated Model Grant Agreement, Article 6, summarised in
  [EMDESK, Cost calculation in Horizon Europe](https://www.emdesk.com/de/guide/cost-calculation-in-horizon-europe-main-changes-to-h2020).
- German funding time records (contemporaneous, project-specific, one programme per hour; hourly rate =
  annual pay / annual working hours, divided by actual hours when those exceed the contract; managing directors
  at most the rate of comparable senior project staff):
  [REB Steuerberatung, Stundenaufzeichnung im geförderten Start-up](https://reb-steuerberatung.de/insights/stundenaufzeichnung-im-gefoerderten-start-up-warum-die-zeiterfassung.html),
  citing ANBest-P-Kosten.
- Working time: Arbeitszeitgesetz § 3 (at most 10 hours per working day).
