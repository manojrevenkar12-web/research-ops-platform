# ADR 1: One access model, enforced by the database

## Context

Internal apps hold data with different owners: shot notes that are restricted technical data, hours that are
personal data, personnel costs that are confidential and split by legal entity. A forward-deployed team builds
an app, hands it over and moves on; the access rules must survive people who did not write them.

## Decision

Access is declared once, in `config/access.yaml`: roles (Entra ID app roles), data classes per column, and
per table and operation a list of rules made of a small vocabulary of predicates (own row, clearance, same
entity, membership of another table, a status, a minimum group size). A generator turns it into PostgreSQL
row-level security policies and table grants; the API and the jobs run every query as the caller, through
transaction-local settings, as a role that cannot bypass row security.

## Consequences

- A forgotten `WHERE` in a handler cannot leak rows: lists, counts, search results and exports all go through
  the same policies, and a hidden row answers 404 rather than 403.
- The model is data, so it can be documented (`docs/ACCESS.md`), turned into Entra app roles, and tested.
- PostgreSQL combines permissive policies per command, not per rule: an UPDATE may pass the USING of one rule and
  the CHECK of another. Column-level guarantees ("a lead changes only the status") therefore live in triggers.
