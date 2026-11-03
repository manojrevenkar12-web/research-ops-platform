# What happened after the first run

The first run of this set (`reports/heldout/blind-1/first_run.json`) passed 40 of 40 cost cases and 163 of
173 access cases. Its failures were studied, so this set is now a regression set (`STATUS` = regression) and
a new held-out set was written by someone else from the updated documents.

- **Six cases named scheduled jobs** (`cost-snapshot`, `reminders`, `dispatcher`) in `as`. The runner only
  knew people; it now also accepts the service principals listed in `docs/FIXTURE.md`. No platform change.
- **Quarter hours** were enforced by the API only. The database now refuses other amounts too
  (migration 0004).
- **A return needs a reason**: the reason lived only in the notification. It is now stored on the entry in its
  own column, `return_reason`, which the database requires when a lead returns an entry (migration 0004), and
  the person sees it on their timesheet.
- **Changing the entity of a personnel cost record** was silently ignored. It is now refused (migration 0004).

One case still fails on purpose: "a grant lead returns a member's submitted entry with a reason" writes the
reason into `note`. `note` is the person's own text, so a lead may not change it; the reason has its own
column. The documents now say so.
