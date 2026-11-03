# ADR 3: Grant costs are computed year to date and differenced by month

## Context

Hourly rates depend on hours worked in the whole year (German cost basis), and the EU day cap applies across a
person's year. A month closed in March cannot know December's hours, and closed months must not change.

## Decision

The cost of a grant for a month is its year-to-date figure at the month's end minus the year-to-date figure at
the previous month's end. Overheads and funding are computed on year-to-date totals too. Closed months are
frozen in the database; any later change of rate shows up as an adjustment, possibly negative, in the first
open month.

## Consequences

- Twelve monthly amounts add up to the year exactly, to the cent (a property test checks this).
- Nobody ever edits a reported month; Finance sees an adjustment with a reason it can trace.
