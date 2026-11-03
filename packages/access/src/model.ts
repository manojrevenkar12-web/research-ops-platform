import { rawConfig } from "@rop/platform";
import { z } from "zod";

const Column = z.string().regex(/^[a-z_][a-z0-9_]*$/);

const Predicate = z.union([
  z.object({ own: Column }).strict(),
  z.object({ not_own: Column }).strict(),
  z.object({ cleared: Column }).strict(),
  z.object({ same_entity: Column }).strict(),
  z
    .object({ in: z.record(Column, z.array(z.string()).min(1)) })
    .strict()
    .refine((p) => Object.keys(p.in).length === 1, "`in` names exactly one column"),
  z
    .object({
      member: z
        .object({
          of: Column,
          on: z.record(Column, Column).refine((o) => Object.keys(o).length > 0, "`on` needs a column"),
          person: Column.optional(),
          roles: z.array(z.string()).min(1).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ at_least: z.object({ column: Column, setting: z.string() }).strict() }).strict(),
]);
export type Predicate = z.infer<typeof Predicate>;

const ReadRule = z
  .object({ roles: z.array(z.string()).min(1), where: z.array(Predicate).default([]) })
  .strict();
const InsertRule = z
  .object({ roles: z.array(z.string()).min(1), check: z.array(Predicate).default([]) })
  .strict();
const UpdateRule = z
  .object({
    roles: z.array(z.string()).min(1),
    using: z.array(Predicate).default([]),
    check: z.array(Predicate).optional(),
  })
  .strict();

const DataClass = z.enum(["internal", "personal", "confidential", "restricted"]);

const Table = z
  .object({
    owner: z.string(),
    columns: z.record(Column, DataClass),
    select: z.array(ReadRule).default([]),
    insert: z.array(InsertRule).default([]),
    update: z.array(UpdateRule).default([]),
    delete: z.array(ReadRule).default([]),
  })
  .strict();

const Model = z
  .object({
    version: z.literal(1),
    roles: z.record(z.string(), z.string()),
    data_classes: z.record(DataClass, z.string()),
    service_principals: z.record(
      z.string(),
      z.object({ roles: z.array(z.string()).min(1), entity: z.string() }).strict(),
    ),
    tables: z.record(Column, Table),
  })
  .strict();

export type ReadRule = z.infer<typeof ReadRule>;
export type InsertRule = z.infer<typeof InsertRule>;
export type UpdateRule = z.infer<typeof UpdateRule>;
export type TableModel = z.infer<typeof Table>;
export type AccessModel = z.infer<typeof Model>;
export type Op = "select" | "insert" | "update" | "delete";
export const OPS: readonly Op[] = ["select", "insert", "update", "delete"];

/** Parse and check the model: roles and columns named in rules must exist. */
export function parseModel(raw: unknown): AccessModel {
  const model = Model.parse(raw);
  const problems = lint(model);
  if (problems.length) throw new Error(`config/access.yaml:\n- ${problems.join("\n- ")}`);
  return model;
}

export function lint(model: AccessModel): string[] {
  const out: string[] = [];
  const roles = new Set(Object.keys(model.roles));
  for (const [name, sp] of Object.entries(model.service_principals)) {
    for (const r of sp.roles) if (!roles.has(r)) out.push(`service principal ${name}: unknown role ${r}`);
  }
  for (const [table, t] of Object.entries(model.tables)) {
    const cols = new Set(Object.keys(t.columns));
    const preds: Predicate[] = [];
    const rules = [...t.select, ...t.insert, ...t.update, ...t.delete];
    for (const rule of rules) {
      for (const r of rule.roles) if (!roles.has(r)) out.push(`${table}: unknown role ${r}`);
    }
    for (const r of t.select) preds.push(...r.where);
    for (const r of t.delete) preds.push(...r.where);
    for (const r of t.insert) preds.push(...r.check);
    for (const r of t.update) preds.push(...r.using, ...(r.check ?? []));
    for (const p of preds) {
      for (const c of rowColumns(p)) if (!cols.has(c)) out.push(`${table}: rule names unknown column ${c}`);
      if ("member" in p) {
        const other = model.tables[p.member.of];
        if (!other) out.push(`${table}: member.of names unknown table ${p.member.of}`);
        else {
          const oc = new Set(Object.keys(other.columns));
          for (const c of [...Object.keys(p.member.on), p.member.person ?? "person_id"]) {
            if (!oc.has(c)) out.push(`${table}: member.of ${p.member.of} has no column ${c}`);
          }
          if (p.member.roles && !oc.has("role"))
            out.push(`${table}: member.of ${p.member.of} has no role column`);
        }
      }
    }
  }
  return out;
}

/** The columns of the row itself that a predicate reads. */
export function rowColumns(p: Predicate): string[] {
  if ("own" in p) return [p.own];
  if ("not_own" in p) return [p.not_own];
  if ("cleared" in p) return [p.cleared];
  if ("same_entity" in p) return [p.same_entity];
  if ("in" in p) return Object.keys(p.in);
  if ("member" in p) return Object.values(p.member.on);
  return [p.at_least.column];
}

let cached: AccessModel | undefined;
export function accessModel(): AccessModel {
  cached ??= parseModel(rawConfig("access.yaml"));
  return cached;
}

export interface Principal {
  personId: string;
  roles: string[];
  entity: string;
  /** Display name for logs and reports; not used for decisions. */
  label?: string;
}
