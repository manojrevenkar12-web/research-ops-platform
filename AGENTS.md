# Working in this repository

## Fast feedback

```bash
pnpm install
scripts/db.sh up                                   # local PostgreSQL 16 on :55432 (CI uses a service container)
export ROP_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres
pnpm test                                          # unit, API, jobs, infra checks, access matrix and policy mutants
pnpm typecheck && pnpm exec biome check .
pnpm generate --check                              # generated files are current
pnpm proof && pnpm handover                        # access proof report, then the handover gate per app
pnpm test:web && pnpm e2e                          # console unit tests; end to end with axe (needs a seeded rop database)
```

## Invariants (each has a test or a gate check)

- **One access model.** Who can see and change what lives in `config/access.yaml` only. The PostgreSQL policies,
  `docs/ACCESS.md` and the Entra app roles are generated from it. Never write a policy, a GRANT or a role
  check by hand; `route({ roles })` is a coarse early refusal, row security is the gate.
- **The proof decides.** `pnpm proof` must show 0 mismatches and no surviving policy mutant. A mutant that
  cannot be caught goes into `config/access_equivalent.yaml` with a reason a reviewer can check, never by
  weakening the matrix.
- **Callers act as themselves.** Every database call of the API and the jobs runs through `asPrincipal`, in one
  transaction, as the runtime role `rop_app` (no BYPASSRLS, owns nothing). Never connect as the owner at run time.
- **The database keeps the record's rules.** Shots and target events are append-only; a closed cost month is
  final; a lead changes only the status (and return reason) of someone else's entry; the daily limit holds under
  concurrency. Triggers enforce these, whoever writes.
- **Code computes money.** Personnel costs come from `packages/costs` only, from the rules in
  `config/grants.yaml` explained in `docs/GRANT_RULES.md`. Thresholds live in `config/`, not in code.
- **Every migration has a down step** that restores the schema exactly (tested).
- **Handover is a gate.** An app changes hands only when `pnpm handover <app>` passes.

## Held-out sets

`heldout/<set>/cases.yaml` is written from the documents by someone who has not read the code, following
`heldout/WRITING_CASES.md`. Never change code to pass a held-out set. Its first run
(`reports/heldout/<set>/first_run.json`) is never rewritten. If you study a set's failures, write `regression`
to `heldout/<set>/STATUS` and have someone who has not seen the code write a new set.
