# Runbook: the platform

Owner: the Software Department.

## First deployment of an environment

1. `cd infra && tofu init -backend-config=env/<env>.backend.hcl && tofu apply -var-file=env/<env>.tfvars`
2. As a member of the database admin group, connect with an Entra token and run the statements in the
   `database_roles_to_create` output: they create a database role per managed identity and make each a member
   of `rop_app`, the role the policies are written for.
3. Run the migrations from CI (`pnpm migrate` with `ROP_DATABASE_URL` pointing at the admin connection).
4. Assign Entra app roles (Staff, Scientist, Finance, ...) to groups in the enterprise application.

## Adding an app

1. Add its tables in a migration with a down step; add every table and column to `config/access.yaml`.
2. Add fixture rows so that every rule of the new tables is the only way someone sees or changes some row.
3. `pnpm generate && pnpm proof`: no mismatch, no surviving mutant (or a reviewed entry in
   `config/access_equivalent.yaml`).
4. Register routes with `route()` (apps/api/src/http.ts) and test each of them.
5. Add the app, owner, runbook and alerts to `config/apps.yaml`; `pnpm handover <app>` must pass before the
   long-term owner takes it.
