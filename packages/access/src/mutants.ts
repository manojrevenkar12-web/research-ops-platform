// Policy mutants: the plausible ways an access rule gets weakened or lost in a hand edit. The access proof
// applies each one to a database and requires the matrix to notice; a mutant nobody notices means the
// fixtures never exercise that rule, so the proof would also miss a real mistake there.
import type { AccessModel, Op, Predicate } from "./model";

export interface PolicyMutant {
  id: string;
  table: string;
  description: string;
  model: AccessModel;
}

const clone = <T>(x: T): T => structuredClone(x);

function describe(p: Predicate): string {
  const [k, v] = Object.entries(p)[0]!;
  return `${k}: ${JSON.stringify(v)}`;
}

export function policyMutants(model: AccessModel, onlyTables?: string[]): PolicyMutant[] {
  const out: PolicyMutant[] = [];
  for (const [table, t] of Object.entries(model.tables)) {
    if (onlyTables && !onlyTables.includes(table)) continue;
    for (const op of ["select", "insert", "update", "delete"] as Op[]) {
      t[op].forEach((rule, i) => {
        const tag = `${table}.${op}[${i + 1}]`;
        {
          const m = clone(model);
          m.tables[table]![op].splice(i, 1);
          out.push({ id: `${tag}:drop-rule`, table, description: `rule removed`, model: m });
        }
        if (!rule.roles.includes("Staff")) {
          const m = clone(model);
          m.tables[table]![op][i]!.roles = ["Staff"];
          out.push({ id: `${tag}:roles-to-staff`, table, description: `roles widened to Staff`, model: m });
        }
        const lists: [string, Predicate[]][] = [];
        if ("where" in rule) lists.push(["where", rule.where]);
        if ("check" in rule && rule.check) lists.push(["check", rule.check]);
        if ("using" in rule) lists.push(["using", rule.using]);
        for (const [key, preds] of lists) {
          preds.forEach((p, j) => {
            const m = clone(model);
            const target = m.tables[table]![op][i] as unknown as Record<string, Predicate[]>;
            target[key]!.splice(j, 1);
            out.push({
              id: `${tag}.${key}[${j + 1}]:drop`,
              table,
              description: `${key} loses ${describe(p)}`,
              model: m,
            });
          });
        }
      });
    }
  }
  return out;
}
