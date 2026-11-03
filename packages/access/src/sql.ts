// Turns the access model into PostgreSQL row-level security. The output is applied by the migration
// runner after every migration, so the policies in the database are always the ones this file produces.
// Row security is enabled, not forced: the runtime role owns nothing and has no BYPASSRLS (the access proof
// checks both), while the owner role only runs migrations and the SECURITY DEFINER trigger functions.
import type { AccessModel, Op, Predicate, TableModel } from "./model";

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not an identifier: ${s}`);
  return s;
};
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const textArray = (xs: string[]) => `ARRAY[${xs.map(literal).join(", ")}]::text[]`;

export function predicateSql(p: Predicate, row: string): string {
  if ("own" in p) return `${row}.${ident(p.own)} = app.person_id()`;
  if ("not_own" in p) return `${row}.${ident(p.not_own)} <> app.person_id()`;
  if ("cleared" in p)
    return `(${row}.${ident(p.cleared)} = 'internal' OR app.has_role('RestrictedTechnical'))`;
  if ("same_entity" in p) return `${row}.${ident(p.same_entity)} = app.entity()`;
  if ("in" in p) {
    const [col, values] = Object.entries(p.in)[0]!;
    return `${row}.${ident(col)} = ANY (${textArray(values)})`;
  }
  if ("member" in p) {
    const m = p.member;
    const conds = Object.entries(m.on).map(([theirs, ours]) => `m.${ident(theirs)} = ${row}.${ident(ours)}`);
    conds.push(`m.${ident(m.person ?? "person_id")} = app.person_id()`);
    if (m.roles) conds.push(`m.role = ANY (${textArray(m.roles)})`);
    return `EXISTS (SELECT 1 FROM public.${ident(m.of)} m WHERE ${conds.join(" AND ")})`;
  }
  return `${row}.${ident(p.at_least.column)} >= app.setting_int(${literal(p.at_least.setting)})`;
}

function conj(roles: string[], preds: Predicate[], table: string): string {
  const parts = [`app.has_any_role(${textArray(roles)})`, ...preds.map((p) => predicateSql(p, table))];
  return parts.map((x) => `(${x})`).join(" AND ");
}

export function policyName(table: string, op: Op, i: number) {
  return `${table}__${op}__${i + 1}`;
}

export function tablePoliciesSql(table: string, t: TableModel, role: string): string {
  const out: string[] = [];
  const q = `public.${ident(table)}`;
  out.push(`ALTER TABLE ${q} ENABLE ROW LEVEL SECURITY;`);
  out.push(
    `DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${literal(table)} LOOP EXECUTE format('DROP POLICY %I ON ${q}', p.policyname); END LOOP; END $$;`,
  );
  t.select.forEach((r, i) => {
    out.push(
      `CREATE POLICY ${policyName(table, "select", i)} ON ${q} FOR SELECT TO ${role} USING (${conj(r.roles, r.where, table)});`,
    );
  });
  t.insert.forEach((r, i) => {
    out.push(
      `CREATE POLICY ${policyName(table, "insert", i)} ON ${q} FOR INSERT TO ${role} WITH CHECK (${conj(r.roles, r.check, table)});`,
    );
  });
  t.update.forEach((r, i) => {
    const check = r.check ? ` WITH CHECK (${conj(r.roles, r.check, table)})` : "";
    out.push(
      `CREATE POLICY ${policyName(table, "update", i)} ON ${q} FOR UPDATE TO ${role} USING (${conj(r.roles, r.using, table)})${check};`,
    );
  });
  t.delete.forEach((r, i) => {
    out.push(
      `CREATE POLICY ${policyName(table, "delete", i)} ON ${q} FOR DELETE TO ${role} USING (${conj(r.roles, r.where, table)});`,
    );
  });
  // Privileges follow the rules: an operation with no rule is not granted at all.
  out.push(`REVOKE ALL ON ${q} FROM ${role};`);
  const ops = (["select", "insert", "update", "delete"] as const).filter((op) => t[op].length > 0);
  if (ops.length) out.push(`GRANT ${ops.map((o) => o.toUpperCase()).join(", ")} ON ${q} TO ${role};`);
  return out.join("\n");
}

export function policiesSql(model: AccessModel, role: string): string {
  const head = [
    "-- Generated from config/access.yaml by packages/access. Do not edit.",
    `GRANT USAGE ON SCHEMA app TO ${role};`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${role};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
  ];
  const body = Object.entries(model.tables).map(
    ([name, t]) => `-- ${name}\n${tablePoliciesSql(name, t, role)}`,
  );
  return `${[...head, ...body].join("\n\n")}\n`;
}

/** Entra ID app roles for the API's app registration, consumed by infra/. */
export function appRolesTfvars(model: AccessModel) {
  const roles = Object.entries(model.roles).map(([value, description]) => ({
    value,
    display_name: value,
    description,
    // Platform is only ever granted to managed identities.
    member_types: value === "Platform" ? ["Application"] : ["User", "Application"],
  }));
  return { app_roles: roles };
}
