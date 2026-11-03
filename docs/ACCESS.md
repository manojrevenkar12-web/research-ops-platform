# Who can see and change what

Generated from `config/access.yaml` by `pnpm generate`. Do not edit. The database enforces exactly this
(row-level security); `pnpm proof` checks it for every principal, table and operation.

## Roles

- **Staff**: Everyone employed by the company.
- **Scientist**: Plans campaigns, logs shots and handles targets.
- **Finance**: Grant accounting and funding reports.
- **PeopleOps**: Employment records, including personnel costs.
- **Executive**: Company-level reporting.
- **RestrictedTechnical**: Cleared to read restricted technical data.
- **Platform**: Service identities that operate the platform; never assigned to a person.

## Tables

### people

Part of the platform.

- **See**: Staff.
- **Add**: nobody through the app.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: id, entra_oid, display_name, email, entity, team, active.

### campaigns

Part of the `shotlog` app.

- **See**: Scientist when it is internal, or they hold RestrictedTechnical (`classification`).
- **See**: Staff when it is their own (`lead_id`) and it is internal, or they hold RestrictedTechnical (`classification`).
- **Add**: Scientist when it is their own (`lead_id`) and it is internal, or they hold RestrictedTechnical (`classification`).
- **Change**: Scientist when it is their own (`lead_id`); the changed row must satisfy: it is their own (`lead_id`) and it is internal, or they hold RestrictedTechnical (`classification`).
- **Delete**: nobody through the app.

Columns: internal: id, code, title, facility, entity, classification, lead_id, starts_on, ends_on, created_at.

### campaign_members

Part of the `shotlog` app.

- **See**: Staff.
- **Add**: Scientist when they are in `campaigns` for this row.
- **Change**: nobody through the app.
- **Delete**: Scientist when they are in `campaigns` for this row.

Columns: internal: campaign_id, person_id, role.

### shots

Part of the `shotlog` app.

- **See**: Scientist when it is internal, or they hold RestrictedTechnical (`classification`).
- **Add**: Scientist when it is their own (`logged_by`) and it is internal, or they hold RestrictedTechnical (`classification`) and they are a lead/operator in `campaign_members` for this row.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: id, campaign_id, shot_no, fired_at, target_id, outcome, classification, logged_by, logged_at, corrects; restricted: energy_j, pulse_ns, notes, search.

### targets

Part of the `shotlog` app.

- **See**: Staff.
- **Add**: Scientist when `status` is fabricated.
- **Change**: Scientist.
- **Delete**: nobody through the app.

Columns: internal: id, serial, batch, design, status, campaign_id, characterization, updated_at.

### target_events

Part of the `shotlog` app.

- **See**: Staff.
- **Add**: nobody through the app.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: id, target_id, from_status, to_status, by_person, at, note.

### grants

Part of the `grants` app.

- **See**: Staff.
- **Add**: Finance.
- **Change**: Finance.
- **Delete**: nobody through the app.

Columns: internal: id, code, title, funder, method, entity, starts_on, ends_on; confidential: funding_rate, indirect_rate.

### work_packages

Part of the `grants` app.

- **See**: Staff.
- **Add**: Finance.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: id, grant_id, code, title.

### grant_members

Part of the `grants` app.

- **See**: Staff.
- **Add**: Finance.
- **Change**: nobody through the app.
- **Delete**: Finance.

Columns: internal: grant_id, person_id, role.

### time_entries

Part of the `grants` app.

- **See**: Staff when it is their own (`person_id`).
- **See**: Staff when they are a lead in `grant_members` for this row.
- **See**: Finance.
- **Add**: Staff when it is their own (`person_id`) and `status` is draft or submitted.
- **Change**: Staff when it is their own (`person_id`) and `status` is draft or returned; the changed row must satisfy: it is their own (`person_id`) and `status` is draft or submitted.
- **Change**: Staff when it is not their own (`person_id`) and `status` is submitted and they are a lead in `grant_members` for this row; the changed row must satisfy: it is not their own (`person_id`) and `status` is approved or returned and they are a lead in `grant_members` for this row.
- **Delete**: Staff when it is their own (`person_id`) and `status` is draft.

Columns: personal: id, person_id, work_date, work_package_id, grant_id, activity, hours, status, approved_by, approved_at, recorded_at, late, note, return_reason.

### salary_costs

Part of the `grants` app.

- **See**: PeopleOps when it belongs to their employing entity (`entity`).
- **See**: Finance when it belongs to their employing entity (`entity`).
- **Add**: PeopleOps when it belongs to their employing entity (`entity`).
- **Change**: PeopleOps when it belongs to their employing entity (`entity`); the changed row must satisfy: it belongs to their employing entity (`entity`).
- **Delete**: nobody through the app.

Columns: personal: person_id; confidential: entity, year, annual_cost_eur, contract_hours, managing_director.

### cost_periods

Part of the `grants` app.

- **See**: Staff.
- **Add**: Finance.
- **Change**: Finance.
- **Delete**: nobody through the app.

Columns: internal: grant_id, period, status, closed_at, closed_by.

### grant_cost_snapshots

Part of the `grants` app.

- **See**: Finance.
- **See**: Executive when `contributors` is at least the `min_group_size` setting.
- **Add**: Finance.
- **Change**: Finance.
- **Delete**: nobody through the app.

Columns: confidential: grant_id, period, direct_eur, indirect_eur, funded_eur, ineligible_hours, contributors, computed_at.

### audit_events

Part of the platform.

- **See**: Finance.
- **Add**: nobody through the app.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: id, at, table_name, row_id, action; personal: actor; confidential: change.

### outbox

Part of the platform.

- **See**: Platform.
- **Add**: Staff, Platform.
- **Change**: Platform.
- **Delete**: nobody through the app.

Columns: internal: id, topic, created_at, dispatched_at, attempts, last_error; personal: payload.

### settings

Part of the platform.

- **See**: Staff.
- **Add**: nobody through the app.
- **Change**: nobody through the app.
- **Delete**: nobody through the app.

Columns: internal: key, value.
