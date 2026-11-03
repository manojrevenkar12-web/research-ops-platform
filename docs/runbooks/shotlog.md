# Runbook: shot log and target inventory

Owner after handover: Experimental Physics (shotlog-owners@example.com). Platform questions: the Software Department.

## What it does

The shot log is the record of every laser shot of a campaign: when it fired, on which target, the energy and
pulse length, the outcome and the operator's notes. Entries are never edited or deleted; a correction is a new
entry that points at the one it corrects, and the list shows the latest version with a count of corrections.
The target inventory follows each target from fabrication through characterisation and allocation to a
campaign until it is shot or scrapped; every change is logged in `target_events` by the database.

## Who uses it

- Scientists plan campaigns, log shots and move targets. A campaign's lead adds operators and observers;
  operators and the lead log shots, observers read.
- Restricted campaigns and shots are visible only with the RestrictedTechnical role (an Entra ID app role).
  Without it a restricted record does not exist for that person: not in lists, search results or counts.
- Everyone can read the target inventory. Someone who led a campaign keeps seeing it after changing team.
- The full rules are in [docs/ACCESS.md](../ACCESS.md), generated from `config/access.yaml`.

## How to run it locally

```bash
pnpm install
pnpm db:up && pnpm migrate && pnpm seed       # local PostgreSQL 16 with the fixture data
AUTH_MODE=dev pnpm dev:api                    # API on :8080 with the dev token issuer
pnpm dev:web                                  # console on :5173; pick a persona to sign in
pnpm test                                     # unit, API, access matrix and policy mutants
```

## How it is deployed

The API runs as an Azure Container App (`infra/apps.tf`), built and pushed by CI, pinned by digest. Schema
changes are migrations in `packages/db/migrations` with a down step each; `pnpm migrate` applies them and then
regenerates the row-level security policies from `config/access.yaml`. Changing who can see what means
changing `config/access.yaml`, running `pnpm generate` and `pnpm proof`, and committing all three.

## Alerts and what to do

- **api_5xx_rate** (more than 2 % of requests fail in 10 minutes): open Application Insights, filter the
  failed requests by `request.id`. A burst of `timeout` problems usually means a slow query: check
  `log_min_duration_statement` output in Log Analytics (PostgreSQLLogs).
- **api_p95_latency** (p95 above 800 ms for 15 minutes): look at the slowest routes in the
  `http_server_duration_ms` metric. Search is the usual suspect; the GIN index `shots_search` must exist.
- **shot_insert_conflicts** (more than 5 retried shot numbers in 30 minutes): two clients log the same campaign
  in a tight loop. Numbers stay unique (advisory lock plus unique index); ask the lead which tool is posting.

## Data and access

- `shots.notes`, `energy_j`, `pulse_ns` are restricted technical data when the row is restricted.
- The database refuses: a non-restricted shot in a restricted campaign, a target shot twice, a target moved
  backwards in its life, any update or delete of a shot or target event.
- A wrong entry is corrected with `POST /api/shotlog/shots/{id}/corrections`; never by SQL.

## Backups and recovery

PostgreSQL Flexible Server keeps point-in-time restore for 35 days (geo-redundant in production). To recover
a mistake, restore to a new server at a time before it, export the affected rows and add them back as
corrections, so the record keeps both versions. Never restore over the live server.

## Known limits

- Attachments (diagnostic files) are not stored here; notes may reference the data store's paths.
- Shots are numbered per campaign by the API, not by the laser control system; the two are not reconciled.
- Search is PostgreSQL full-text search in English; German notes are matched less well.
