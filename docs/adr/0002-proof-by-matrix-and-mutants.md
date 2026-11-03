# ADR 2: Prove access with a matrix and policy mutants

## Context

Reviewing generated SQL policies does not show what a given person can do, and a handful of example tests
leaves most combinations unchecked.

## Decision

A reference evaluator (TypeScript) reads the same model and computes what the database should allow, with
PostgreSQL's rules for combining policies, including UPDATE and DELETE without a WHERE clause (which skip
SELECT policies). The access matrix runs every principal (10 people, 3 job identities) against every table and
operation on the fixture: selects, candidate inserts, updates of every row with several changes, deletes, and
statements without a WHERE clause. Every outcome must equal the evaluator's.

Then every rule is weakened in the plausible ways (removed, widened to all staff, one condition dropped) and the
matrix must notice each. A weakening nobody notices means the fixtures never exercise that rule; the fix is a
fixture row, or, if something else already guarantees the rule, an entry in `config/access_equivalent.yaml`
with a reason.

## Consequences

- Writing the fixtures found real design points: a person who left the lab still leads old campaigns; a
  clearance can lapse; a person can transfer between entities.
- Two independent implementations (SQL and TypeScript) can share a misunderstanding of the model's intent;
  the blind held-out set, written from the documents only, checks that.
