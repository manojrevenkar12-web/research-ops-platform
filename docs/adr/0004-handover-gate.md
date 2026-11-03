# ADR 4: A handover gate per app

## Context

In the forward-deployed model the engineer leaves after delivery. What usually goes missing is not code but the
things the next owner needs: who owns it, what to do when an alert fires, proof that access is right, tests for
every route, a way back from a bad migration.

## Decision

`config/apps.yaml` names each app's owner, tables, routes, runbook and alerts. `pnpm handover` checks: owner
named; runbook with the required sections; every alert defined, wired to a metric the code emits and explained
in the runbook; every route called by a test; no unfinished-work markers; the access proof current and clean on
the app's tables; migrations reversible; every column classified; generated files and the OpenAPI document current.

## Consequences

The gate is cheap to run in CI and turns "ready to hand over" from an opinion into a list anyone can check.
