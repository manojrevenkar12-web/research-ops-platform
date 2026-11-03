# What happened after the first run

The first run of this set (`reports/heldout/blind-2/first_run.json`), written from the documents after the
first set's fixes, passed 44 of 44 cost cases and 221 of 222 access cases. Its one failure and one ambiguity
the writer raised in its README were studied, so this set is now a regression set.

- **The owner "changing" the lead's return reason** succeeded as a statement but changed nothing: the trigger
  silently kept the old value. It is now refused (migration 0005), the same lesson as the first set's entity
  finding: a change the database does not allow must fail, not vanish.
- **Ambiguity 4 in the README was a real gap.** A campaign lead whose clearance had lapsed could declassify
  their own restricted campaign with an `UPDATE` without a `WHERE` clause: the update rule checked clearance on
  the new row only, and a declassified row passes that check. The rule now requires clearance on the existing
  row too. The access proof could not find this, because it checks the database against the model and the model
  itself allowed it; a reader of the documents did.

No new blind set has been written after these fixes yet.
