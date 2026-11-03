// Everything generated from config: the SQL policies, the who-can-see document, the Entra app roles and
// Azure alert rules for infra/, and the OpenAPI document.
import { accessModel, appRolesTfvars, type Predicate, policiesSql } from "@rop/access";
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

export async function generatedFiles(): Promise<Record<string, string>> {
  const json = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`;
  return {
    "packages/db/generated/policies.sql": policiesSql(accessModel(), platformConfig().database.runtime_role),
    "docs/ACCESS.md": accessDoc(),
    "infra/app_roles.auto.tfvars.json": json(appRolesTfvars(accessModel())),
    "infra/alerts.auto.tfvars.json": json(alertsTfvars()),
    "docs/openapi.json": json(await openApiDocument()),
  };
}
