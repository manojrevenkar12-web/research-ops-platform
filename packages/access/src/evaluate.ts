// The reference evaluator: what the database *should* allow, computed in TypeScript from the same model
// with PostgreSQL's rules for combining policies. The access proof runs every principal against the real
// database and compares; a disagreement means either the generator or the evaluator is wrong.
import type { AccessModel, Predicate, Principal } from "./model";

export type Row = Record<string, unknown>;
export type Snapshot = Record<string, Row[]>;

const has = (p: Principal, roles: string[]) => roles.some((r) => p.roles.includes(r));
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

export class Evaluator {
  constructor(
    readonly model: AccessModel,
    readonly snapshot: Snapshot,
  ) {}

  private setting(key: string): number {
    const row = (this.snapshot.settings ?? []).find((r) => r.key === key);
    if (!row) return Number.NaN; // app.setting_int returns NULL: the comparison is never true
    return Number(row.value);
  }

  predicate(p: Predicate, row: Row, who: Principal, depth = 0): boolean {
    if ("own" in p) return same(row[p.own], who.personId);
    if ("not_own" in p) return row[p.not_own] != null && String(row[p.not_own]) !== who.personId;
    if ("cleared" in p) return row[p.cleared] === "internal" || who.roles.includes("RestrictedTechnical");
    if ("same_entity" in p) return same(row[p.same_entity], who.entity);
    if ("in" in p) {
      const [col, values] = Object.entries(p.in)[0]!;
      return row[col] != null && values.includes(String(row[col]));
    }
    if ("member" in p) {
      const m = p.member;
      // The sub-query in the policy runs under the caller's own row security on the other table.
      const rows = this.visible(m.of, who, depth + 1);
      return rows.some(
        (o) =>
          Object.entries(m.on).every(([theirs, ours]) => same(o[theirs], row[ours])) &&
          same(o[m.person ?? "person_id"], who.personId) &&
          (!m.roles || m.roles.includes(String(o.role))),
      );
    }
    const v = row[p.at_least.column];
    return v != null && Number(v) >= this.setting(p.at_least.setting);
  }

  private all(preds: Predicate[], row: Row, who: Principal, depth = 0) {
    return preds.every((p) => this.predicate(p, row, who, depth));
  }

  canSelect(table: string, row: Row, who: Principal, depth = 0): boolean {
    if (depth > 8) throw new Error(`policy recursion through ${table}`);
    const t = this.model.tables[table];
    if (!t) return false;
    return t.select.some((r) => has(who, r.roles) && this.all(r.where, row, who, depth));
  }

  visible(table: string, who: Principal, depth = 0): Row[] {
    return (this.snapshot[table] ?? []).filter((r) => this.canSelect(table, r, who, depth));
  }

  canInsert(table: string, row: Row, who: Principal): boolean {
    const t = this.model.tables[table];
    return !!t && t.insert.some((r) => has(who, r.roles) && this.all(r.check, row, who));
  }

  /**
   * An UPDATE whose WHERE clause reads the table must find the old row through a SELECT policy and an UPDATE
   * policy's USING; the new row must pass some UPDATE policy's WITH CHECK (its USING when it has no check)
   * and, because the statement reads the table, a SELECT policy too. "skipped" means 0 rows were updated;
   * "denied" is a row-security error.
   */
  updateOutcome(table: string, oldRow: Row, newRow: Row, who: Principal): "allowed" | "denied" | "skipped" {
    const t = this.model.tables[table];
    if (!t || !t.update.length) return "skipped";
    if (!this.canSelect(table, oldRow, who)) return "skipped";
    if (!this.usingMatches(table, oldRow, who)) return "skipped";
    return this.checkMatches(table, newRow, who) && this.canSelect(table, newRow, who) ? "allowed" : "denied";
  }

  /**
   * An UPDATE that does not read the table (no WHERE, no RETURNING) applies no SELECT policy: it touches
   * every row an UPDATE policy's USING admits, and fails as a whole if any new row fails every check.
   */
  blindUpdate(table: string, change: Row, who: Principal): string {
    const rows = (this.snapshot[table] ?? []).filter((r) => this.usingMatches(table, r, who));
    if (rows.some((r) => !this.checkMatches(table, { ...r, ...change }, who))) return "denied";
    return rows.length ? `allowed:${rows.length}` : "skipped";
  }

  blindDelete(table: string, who: Principal): string {
    const t = this.model.tables[table];
    const rows = (this.snapshot[table] ?? []).filter((r) =>
      t?.delete.some((d) => has(who, d.roles) && this.all(d.where, r, who)),
    );
    return rows.length ? `allowed:${rows.length}` : "skipped";
  }

  private usingMatches(table: string, row: Row, who: Principal): boolean {
    const t = this.model.tables[table];
    return !!t && t.update.some((r) => has(who, r.roles) && this.all(r.using, row, who));
  }

  private checkMatches(table: string, row: Row, who: Principal): boolean {
    const t = this.model.tables[table];
    return !!t && t.update.some((r) => has(who, r.roles) && this.all(r.check ?? r.using, row, who));
  }

  deleteOutcome(table: string, row: Row, who: Principal): "allowed" | "skipped" {
    const t = this.model.tables[table];
    if (!t) return "skipped";
    if (!this.canSelect(table, row, who)) return "skipped";
    return t.delete.some((d) => has(who, d.roles) && this.all(d.where, row, who)) ? "allowed" : "skipped";
  }
}
