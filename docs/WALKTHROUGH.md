# A guided tour (15 minutes)

For a reviewer who wants to see how the platform works and why, in the order that explains it best.

## 1. The problem (2 minutes)

A small software team builds internal apps for scientists, Finance, Legal and management, hands each one to a
long-term owner and moves on. Three things go wrong in that model: access rules are written per app and drift;
sensitive data (restricted technical data, hours, pay) leaks through the parts nobody reviews (search, counts,
exports, jobs); and the owner inherits an app without a runbook, alerts or proof that it works.

## 2. One access model (3 minutes)

- Read `config/access.yaml` top to bottom; then `docs/ACCESS.md`, which is generated from it.
- `packages/access/src/sql.ts` turns it into row-level security; `packages/db/src/session.ts` runs each request
  as the caller in one transaction (`asPrincipal`).
- Try it: `apps/api/test/shotlog.test.ts`, "search only finds what you may read".

Questions worth asking:
- *Why the database and not the API?* Because every query path goes through it: lists, counts, full-text
  search, the scheduled jobs. A handler that forgets a `WHERE` still cannot leak.
- *Why 404 and not 403 for a hidden campaign?* A 403 would confirm the restricted campaign exists.
- *Can a pooled connection carry one person's identity into the next request?* No: the settings are
  transaction-local (`set_config(..., true)`); `platform.test.ts` checks five pooled connections after a request.

## 3. Proving it (4 minutes)

- `packages/access/src/evaluate.ts` is the reference evaluator; read `updateOutcome` and `blindUpdate`.
- `packages/db/src/proof.ts` runs the matrix; `reports/access/proof.json` is the latest result: about 5,000
  statements by 13 principals, 0 disagreements, 108 of 110 policy mutants caught, 2 equivalent with reasons
  (`config/access_equivalent.yaml`).
- The console's "Who can see what" page shows the same report.

Questions worth asking:
- *What did the mutants find?* That PostgreSQL applies no SELECT policy to an UPDATE without a WHERE clause, so a
  too-wide UPDATE rule hides behind the SELECT rule until someone writes a blind update; the matrix now tries
  those. And that a lead could approve their own hours if a CHECK clause were dropped, because PostgreSQL may
  combine one rule's USING with another rule's CHECK.

## 4. Money (3 minutes)

- `docs/GRANT_RULES.md` (with sources), `config/grants.yaml`, `packages/costs/src/index.ts`.
- Year to date, differenced by month (ADR 3); late records not charged; another entity's staff listed, not
  charged; Executive sees a total only over at least 3 people.
- Property tests in `packages/costs/test/costs.test.ts`: monthly amounts add up to the year to the cent; nobody
  is charged more than their annual cost.

## 5. Handing over (2 minutes)

- `config/apps.yaml`, `docs/runbooks/`, `scripts/handover.ts`, `reports/handover/*.md`.
- `infra/`: OpenTofu for Azure, managed identities and no database password anywhere; alerts generated from
  `config/alerts.yaml`.

## 6. What the blind sets found (1 minute)

`heldout/blind-1/STUDIED.md`: a separate writer, from the documents only, found that quarter hours, the return
reason and the entity of a pay record were enforced only by the API, or silently ignored. Fixed in migration
0004; the set became a regression set and `heldout/blind-2` was written fresh.
