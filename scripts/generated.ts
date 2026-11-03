// Everything generated from config: the SQL policies, the who-can-see document, the Entra app roles and
// Azure alert rules for infra/, and the OpenAPI document.
import { accessModel, appRolesTfvars, type Predicate, policiesSql } from "@rop/access";
import { FIXTURE, PERSONAS, TABLE_ORDER } from "@rop/db";
import { alertsConfig, appsConfig, platformConfig } from "@rop/platform";
import { openApiDocument } from "./openapi";

function describe(p: Predicate): string {
  if ("own" in p) return `it is their own (\`${p.own}\`)`;
  if ("not_own" in p) return `it is not their own (\`${p.not_own}\`)`;
  if ("cleared" in p) return `it is internal, or they hold RestrictedTechnical (\`${p.cleared}\`)`;
  if ("same_entity" in p) return `it belongs to their employing entity (\`${p.same_entity}\`)`;
  if ("in" in p) {
    const [c, v] = Object.entries(p.in)[0]!;
    return `\`${c}\` is ${v.join(" or ")}`;
  }
  if ("member" in p) {
    const m = p.member;
    return `they are ${m.roles ? `a ${m.roles.join("/")} ` : ""}in \`${m.of}\` for this row`;
  }
  return `\`${p.at_least.column}\` is at least the \`${p.at_least.setting}\` setting`;
}

function accessDoc(): string {
  const m = accessModel();
  const out = [
    "# Who can see and change what",
    "",
    "Generated from `config/access.yaml` by `pnpm generate`. Do not edit. The database enforces exactly this",
    "(row-level security); `pnpm proof` checks it for every principal, table and operation.",
    "",
    "## Roles",
    "",
    ...Object.entries(m.roles).map(([r, d]) => `- **${r}**: ${d}`),
    "",
    "## Tables",
    "",
  ];
  for (const [table, t] of Object.entries(m.tables)) {
    out.push(
      `### ${table}`,
      "",
      t.owner === "software" ? "Part of the platform." : `Part of the \`${t.owner}\` app.`,
      "",
    );
    const verbs = { select: "See", insert: "Add", update: "Change", delete: "Delete" } as const;
    for (const op of ["select", "insert", "update", "delete"] as const) {
      const rules = t[op];
      if (!rules.length) {
        out.push(`- **${verbs[op]}**: nobody through the app.`);
        continue;
      }
      for (const r of rules) {
        const preds: Predicate[] =
          "where" in r
            ? r.where
            : "check" in r && !("using" in r)
              ? r.check
              : (r as { using: Predicate[] }).using;
        const cond = preds.length ? ` when ${preds.map(describe).join(" and ")}` : "";
        const after =
          "using" in r && r.check
            ? `; the changed row must satisfy: ${r.check.map(describe).join(" and ")}`
            : "";
        out.push(`- **${verbs[op]}**: ${r.roles.join(", ")}${cond}${after}.`);
      }
    }
    const classes = Object.entries(t.columns).reduce<Record<string, string[]>>((acc, [c, k]) => {
      acc[k] = [...(acc[k] ?? []), c];
      return acc;
    }, {});
    out.push(
      "",
      `Columns: ${Object.entries(classes)
        .map(([k, cs]) => `${k}: ${cs.join(", ")}`)
        .join("; ")}.`,
      "",
    );
  }
  return out.join("\n");
}

function alertsTfvars() {
  const apps = appsConfig().apps;
  return {
    alerts: Object.fromEntries(
      Object.entries(alertsConfig().alerts).map(([name, a]) => [
        name,
        {
          metric: a.metric,
          filter: a.filter ?? {},
          condition: a.condition,
          threshold: a.threshold,
          window_minutes: a.window_minutes,
          severity: a.severity,
          apps: Object.entries(apps)
            .filter(([, app]) => app.alerts.includes(name))
            .map(([k]) => k),
        },
      ]),
    ),
  };
}

function fixtureDoc(): string {
  const out = [
    "# The fixture: people and data used by tests, the access proof and the demo",
    "",
    "Generated from `packages/db/src/fixtures.ts` by `pnpm generate`. Do not edit.",
    "",
    "## People",
    "",
    "| Key | Name | Entity | Team | Roles | Person id |",
    "|---|---|---|---|---|---|",
    ...Object.values(PERSONAS).map(
      (p) => `| ${p.key} | ${p.name} | ${p.entity} | ${p.team} | ${p.roles.join(", ")} | \`${p.personId}\` |`,
    ),
    "",
    "Service principals (scheduled jobs): " +
      Object.entries(accessModel().service_principals)
        .map(([k, v]) => `${k} (${v.roles.join(", ")})`)
        .join("; ") +
      ".",
    "",
  ];
  const name = new Map(Object.values(PERSONAS).map((p) => [p.personId, p.key]));
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return name.has(s)
      ? `${name.get(s)} (\`${s}\`)`
      : s.includes("-4000-8000-")
        ? `\`${s}\``
        : s.replaceAll("|", "/");
  };
  for (const table of TABLE_ORDER) {
    if (table === "people") continue;
    const rows = (FIXTURE as Record<string, Record<string, unknown>[]>)[table] ?? [];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!);
    out.push(`## ${table}`, "", `| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`);
    for (const r of rows) out.push(`| ${cols.map((c) => cell(r[c])).join(" | ")} |`);
    out.push("");
  }
  return out.join("\n");
}

export async function generatedFiles(): Promise<Record<string, string>> {
  const json = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`;
  return {
    "packages/db/generated/policies.sql": policiesSql(accessModel(), platformConfig().database.runtime_role),
    "docs/ACCESS.md": accessDoc(),
    "docs/FIXTURE.md": fixtureDoc(),
    "infra/app_roles.auto.tfvars.json": json(appRolesTfvars(accessModel())),
    "infra/alerts.auto.tfvars.json": json(alertsTfvars()),
    "docs/openapi.json": json(await openApiDocument()),
  };
}
