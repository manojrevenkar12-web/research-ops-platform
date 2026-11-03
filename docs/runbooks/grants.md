# Runbook: grant time and cost reporting

Owner after handover: Finance (grants-owners@example.com). Platform questions: the Software Department.

## What it does

People record the hours they work, per day and work package, as they go. A grant's lead approves or returns
each submitted entry. Finance computes each month's personnel costs per grant from approved hours and annual
personnel costs, then closes the month: the figures are frozen and nothing in that month can change after.
A nightly job keeps the figures of open months current; executives see grant totals by month.

## Who uses it

- Everyone records their own hours and sees only their own.
- A grant's lead sees and decides the hours booked to that grant; they cannot approve their own.
- Finance sees all hours and the personnel costs of its own entity, computes costs and closes months.
- PeopleOps maintains personnel costs (annual cost, contract hours) for its own entity.
- Executive sees monthly grant totals, but only when at least `reporting.min_group_size` people (3) are in
  them: a total over one or two people is their pay.
- The full rules are in [docs/ACCESS.md](../ACCESS.md); the cost rules in [docs/GRANT_RULES.md](../GRANT_RULES.md).

## How to run it locally

```bash
pnpm db:up && pnpm migrate && pnpm seed
AUTH_MODE=dev pnpm dev:api
pnpm dev:web            # sign in as Hana to record hours, Ben to approve, Dan for costs, Gus for totals
pnpm job cost-snapshot  # the nightly job, once
```

## How it is deployed

API: Azure Container App. Jobs: Azure Functions timer triggers (`apps/jobs`, `infra/functions.tf`) with the
schedules in `config/jobs.yaml`; each job acts as a service principal from `config/access.yaml`, so row
security limits a job like a person. Funding rules live in `config/grants.yaml` and belong to Finance; a change
there changes computed figures for open months only.

## Alerts and what to do

- **api_5xx_rate**, **api_p95_latency**: as in the shot log runbook.
- **cost_snapshot_failed** (the nightly job failed for some grant month): the job log names the grant and
  month. `missing personnel cost` means someone booked hours to a grant in a year without a personnel cost
  record; PeopleOps adds it, then run `pnpm job cost-snapshot` or wait for the next night. Other months were
  still written.
- **unsubmitted_hours_backlog** (more than 200 draft or returned entries older than the recording window):
  reminders go out on Mondays; if the number keeps growing, tell the grant leads before a month is closed.

## Data and access

- Hours are personal data; personnel costs are confidential and visible to Finance and PeopleOps of the
  same entity only. The audit log records who changed a personnel cost, never the amounts.
- The database enforces, for everyone including Finance: at most 10 hours a day per person, no future dates,
  only grants the person works on and within the grant's dates, no changes in a closed month, a lead may
  change only the status of someone else's entry, approvals are stamped with who and when.
- Entries recorded more than 7 days after the work are kept but marked late and not charged.

## Backups and recovery

Point-in-time restore, 35 days. A closed month is final by design: a correction found later is made in the
open month (year-to-date computation turns it into an adjustment). Restoring a closed month means restoring
to a separate server and handing Finance the figures, not changing the live record.

## Known limits

- The cost rules model two methods (EU daily rate, German hourly cost basis); a grant with other rules needs
  a new method in `packages/costs` and a held-out case for it.
- Hours of another entity's employees are listed but not charged; intercompany recharges are out of scope.
- Delivery of reminder e-mails (Microsoft Graph) is not implemented; reminders queue in the outbox.
