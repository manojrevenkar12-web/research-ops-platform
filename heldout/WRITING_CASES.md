# Writing a held-out set

A held-out set checks the platform against its documents, written by someone who has **not** read the code.
It is run once and its first result is recorded in `reports/heldout/<set>/first_run.json`, which is never
rewritten. If its failures are studied to change the code, the set becomes a regression set
(`heldout/<set>/STATUS` = `regression`) and a new held-out set is written by someone else.

## What you may read

- `docs/GRANT_RULES.md` and `config/grants.yaml`: how hours are recorded and costs computed.
- `docs/ACCESS.md`: who can see and change what (generated from `config/access.yaml`, which you may also read).
- `docs/FIXTURE.md`: the people and rows in the database when access cases run.
- This file.

Do **not** read anything under `packages/`, `apps/`, `scripts/`, `tests/`, `infra/` or the migrations, and do
not run the code. Where the documents are unclear, decide what they most plausibly mean, write the case, and
note the ambiguity in your README (an ambiguity is a finding, not a failure on your part).

## Files

`heldout/<set>/cases.yaml`, `heldout/<set>/README.md` (what you covered, every ambiguity you met, anything
the documents seem to get wrong), `heldout/<set>/STATUS` containing `heldout`.

## Cost cases

Each case describes a grant, people, personnel costs and time entries from scratch (nothing from the
fixture), a month, and what the figures for that grant and month must be.

```yaml
cost_cases:
  - name: one person, EU daily rate          # unique, says what is being checked
    grant: { method: eu_daily, entity: DE, funding_rate: 0.7, indirect_rate: 0.25 }
    other_grants:                            # optional: further grants entries may point at
      - { id: g2, method: eu_daily, entity: DE }
    people: { anna: DE, bob: US }            # person -> employing entity
    salaries:                                # personnel cost records
      - { person: anna, year: 2026, annual_cost_eur: 86000, contract_hours: 1720, managing_director: false }
    entries:                                 # grant: "this" (the case's grant), an other_grants id, or null
      - { person: anna, grant: this, date: 2026-03-10, hours: 8, status: approved, late: false }
    period: 2026-03
    expect:                                  # any subset; amounts as strings with two decimals
      direct_eur: "400.00"
      indirect_eur: "100.00"
      funded_eur: "350.00"
      ineligible_hours: "0.00"
      contributors: 1
      lines:                                 # optional, per person, any subset of these fields
        anna: { eligible_hours: "8.00", direct_eur: "400.00", other_entity_hours: "0.00", late_hours: "0.00", over_cap_hours: "0.00" }
  - name: refuses without a personnel cost record
    # ...
    expect_error: missing_personnel_cost
```

Statuses: `draft`, `submitted`, `approved`, `returned`. `late` is given directly (the case states whether the
entry was recorded late). Compute expected numbers by hand from the documents; write the arithmetic in a
comment next to each expected value.

## Access cases

Each case runs one statement as one person of the fixture (`as`: a key from `docs/FIXTURE.md`) against the
fixture database, inside a transaction that is rolled back afterwards, so cases do not affect each other.

```yaml
access_cases:
  - name: a scientist without clearance cannot see a restricted campaign
    as: ben
    table: campaigns
    op: select                 # select | insert | update | delete
    row: { code: PHX-26-R1 }   # select/update/delete: column values that identify existing rows
    expect: hidden             # select: visible | hidden
  - name: a member records their own draft hours
    as: hana
    table: time_entries
    op: insert
    values: { person_id: "00000000-0000-4000-8000-000100000008", work_date: 2026-10-20, activity: x, hours: 1, status: draft }
    expect: allowed            # insert/update/delete: allowed (the row was written) | denied (it was not, for any reason)
  - name: a lead cannot approve their own submitted entry
    as: ben
    table: time_entries
    op: update
    row: { id: "00000000-0000-4000-8000-000800000008" }
    change: { status: approved }
    expect: denied
```

For `select`, `visible` means at least one row matching `row` is visible to that person. The run date is
3 November 2026 or later; avoid expectations that depend on today's date unless the documents make them
certain (for example, a date in October 2026 is in the past and more than 7 days ago).

Aim for 30 or more cost cases and 40 or more access cases, covering every rule in the documents, the edges
(rounding, caps, the year boundary, negative adjustments, other entities, managing directors, late entries)
and every role.
