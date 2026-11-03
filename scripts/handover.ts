// The handover gate: an app may go to its long-term owner only when everything that owner will need is there
// and true. `pnpm handover [app]` checks every app in config/apps.yaml (or one) and writes
// reports/handover/<app>.json, <app>.md and summary.json. It exits non-zero when any check fails.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessModel } from "@rop/access";
import { createTestDb, migrateDown, migrateUp, migrations } from "@rop/db";
import { METRICS } from "@rop/observability";
import { alertsConfig, appsConfig, ROOT } from "@rop/platform";
import { registry } from "../apps/api/src/http";
import { generatedFiles } from "./generated";
import { openApiDocument } from "./openapi";
import { proofInputsHash } from "./proof";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function runbookChecks(app: string): Check[] {
  const cfg = appsConfig();
  const a = cfg.apps[app]!;
  const p = join(ROOT, a.runbook);
  if (!existsSync(p)) return [{ name: "runbook", pass: false, detail: `${a.runbook} is missing` }];
  const text = readFileSync(p, "utf8");
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
  const missing = cfg.handover.runbook_sections.filter((s) => !headings.includes(s));
  const alertsSection = text.split(/^## /m).find((s) => s.startsWith("Alerts and what to do")) ?? "";
  const unexplained = a.alerts.filter((x) => !alertsSection.includes(x));
  const owner = a.owner.team && a.owner.contact.includes("@");
  return [
    { name: "owner named", pass: !!owner, detail: `${a.owner.team} <${a.owner.contact}>` },
    {
      name: "runbook sections",
      pass: missing.length === 0,
      detail: missing.length
        ? `missing: ${missing.join(", ")}`
        : `${headings.length} sections in ${a.runbook}`,
    },
    {
      name: "every alert explained in the runbook",
      pass: unexplained.length === 0,
      detail: unexplained.length ? `not explained: ${unexplained.join(", ")}` : `${a.alerts.length} alerts`,
    },
  ];
}

function alertChecks(app: string): Check[] {
  const a = appsConfig().apps[app]!;
  const defined = alertsConfig().alerts;
  const unknown = a.alerts.filter((x) => !defined[x]);
  const noMetric = a.alerts.filter((x) => defined[x] && !(defined[x]!.metric in METRICS));
  return [
    {
      name: "alerts defined and wired to emitted metrics",
      pass: unknown.length === 0 && noMetric.length === 0,
      detail:
        [
          unknown.length ? `undefined: ${unknown.join(", ")}` : "",
          noMetric.length ? `metric not emitted: ${noMetric.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ") || a.alerts.join(", "),
    },
  ];
}

function routeChecks(app: string): Check[] {
  const cfg = appsConfig();
  const a = cfg.apps[app]!;
  const routes = registry
    .filter((r) => r.app === app && r.url.startsWith(a.routes_prefix))
    .map((r) => `${r.method} ${r.url}`);
  const dir = join(ROOT, "reports", "coverage", "routes");
  const hit = new Set<string>();
  if (existsSync(dir))
    for (const f of readdirSync(dir))
      for (const r of JSON.parse(readFileSync(join(dir, f), "utf8"))) hit.add(r);
  const untested = routes.filter((r) => !hit.has(r));
  const ratio = routes.length ? (routes.length - untested.length) / routes.length : 0;
  return [
    {
      name: "every route called by a test",
      pass: routes.length > 0 && ratio >= cfg.handover.min_route_test_coverage,
      detail: untested.length
        ? `${routes.length - untested.length}/${routes.length}; untested: ${untested.join(", ")}`
        : `${routes.length}/${routes.length} routes`,
    },
  ];
}

function sourceChecks(app: string): Check[] {
  const p = join(ROOT, "apps", "api", "src", "features", `${app}.ts`);
  const text = readFileSync(p, "utf8");
  const markers = text
    .split("\n")
    .flatMap((l, i) => (/\b(TODO|FIXME|XXX)\b/.test(l) ? [`line ${i + 1}`] : []));
  return [
    {
      name: "no unfinished-work markers in the app's code",
      pass: markers.length === 0,
      detail: markers.join(", ") || "none",
    },
  ];
}

function proofChecks(app: string): Check[] {
  const a = appsConfig().apps[app]!;
  const p = join(ROOT, "reports", "access", "proof.json");
  if (!existsSync(p)) return [{ name: "access proof", pass: false, detail: "run pnpm proof" }];
  const proof = JSON.parse(readFileSync(p, "utf8"));
  const fresh = proof.inputs === proofInputsHash();
  const rows = a.tables.map((t) => [t, proof.by_table[t]] as const);
  const missing = rows.filter(([, r]) => !r).map(([t]) => t);
  const bad = rows.filter(([, r]) => r && (r.mismatches || r.survived)).map(([t]) => t);
  const mutants = rows.reduce((s, [, r]) => s + (r?.mutants ?? 0), 0);
  const caught = rows.reduce((s, [, r]) => s + (r?.caught ?? 0), 0);
  return [
    {
      name: "access proof is current",
      pass: fresh,
      detail: fresh
        ? `inputs ${proof.inputs}`
        : "access model, fixtures or migrations changed since the last pnpm proof",
    },
    {
      name: "database matches the access model on the app's tables, every policy mutant caught",
      pass: missing.length === 0 && bad.length === 0,
      detail: missing.length
        ? `not in the proof: ${missing.join(", ")}`
        : bad.length
          ? `failing: ${bad.join(", ")}`
          : `${caught}/${mutants} mutants caught, the rest listed as equivalent with reasons`,
    },
  ];
}

async function schemaChecks(
  app: string,
  cache: { reversible?: Check; columns?: Record<string, string[]> },
): Promise<Check[]> {
  const a = appsConfig().apps[app]!;
  if (!cache.reversible || !cache.columns) {
    const db = await createTestDb({ migrate: false });
    const c = await db.admin.connect();
    try {
      const dump = () =>
        execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-comments", db.urls.admin], {
          encoding: "utf8",
        })
          .split("\n")
          .filter((l) => !l.startsWith("\\restrict") && !l.startsWith("\\unrestrict") && !l.startsWith("--"))
          .join("\n");
      await migrateUp(c);
      const up = dump();
      await migrateDown(c, migrations().length);
      await migrateUp(c);
      const ok = dump() === up;
      cache.reversible = {
        name: "migrations reversible",
        pass: ok,
        detail: ok
          ? `${migrations().length} migrations down and up again give the same schema`
          : "schema differs after down and up",
      };
      const cols = await c.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
      );
      cache.columns = {};
      for (const r of cols.rows) {
        cache.columns[r.table_name] = [...(cache.columns[r.table_name] ?? []), r.column_name];
      }
    } finally {
      c.release();
      await db.drop();
    }
  }
  const model = accessModel();
  const problems: string[] = [];
  for (const t of a.tables) {
    const declared = Object.keys(model.tables[t]?.columns ?? {});
    const actual = cache.columns[t] ?? [];
    if (!model.tables[t]) problems.push(`${t} not in config/access.yaml`);
    for (const c of actual) if (!declared.includes(c)) problems.push(`${t}.${c} has no data class`);
    for (const c of declared)
      if (!actual.includes(c)) problems.push(`${t}.${c} declared but not in the database`);
  }
  return [
    cache.reversible,
    {
      name: "every column has a data class",
      pass: problems.length === 0,
      detail: problems.join("; ") || `${a.tables.length} tables`,
    },
  ];
}

async function generatedChecks(app: string): Promise<Check[]> {
  const files = await generatedFiles();
  const stale = Object.entries(files).filter(
    ([rel, content]) => !existsSync(join(ROOT, rel)) || readFileSync(join(ROOT, rel), "utf8") !== content,
  );
  const doc = await openApiDocument();
  const prefix = appsConfig().apps[app]!.routes_prefix;
  const documented = Object.keys(doc.paths).filter((p) => p.startsWith(prefix)).length;
  return [
    {
      name: "generated files current",
      pass: stale.length === 0,
      detail: stale.length
        ? `stale: ${stale.map(([r]) => r).join(", ")}`
        : "policies, ACCESS.md, tfvars, openapi.json",
    },
    {
      name: "API documented",
      pass: documented > 0,
      detail: `${documented} paths under ${prefix} in docs/openapi.json`,
    },
  ];
}

function markdown(app: string, checks: Check[]): string {
  const a = appsConfig().apps[app]!;
  const pass = checks.every((c) => c.pass);
  return [
    `# Handover: ${a.title}`,
    "",
    `Generated by \`pnpm handover ${app}\`. ${pass ? "**Ready for handover**" : "**Not ready**"} to ${a.owner.team} (${a.owner.contact}).`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.name} | ${c.pass ? "pass" : "FAIL"} | ${c.detail.replaceAll("|", "\\|")} |`),
    "",
    `Runbook: [${a.runbook}](../../${a.runbook}). Access rules: [docs/ACCESS.md](../../docs/ACCESS.md).`,
    "",
  ].join("\n");
}

async function main() {
  const want = process.argv[2];
  const apps = Object.keys(appsConfig().apps).filter((a) => !want || a === want);
  if (!apps.length) throw new Error(`unknown app ${want}`);
  await openApiDocument(); // registers the routes
  const out = join(ROOT, "reports", "handover");
  mkdirSync(out, { recursive: true });
  const cache = {};
  const summary: Record<string, unknown> = {};
  let failed = false;
  for (const app of apps) {
    const checks = [
      ...runbookChecks(app),
      ...alertChecks(app),
      ...routeChecks(app),
      ...sourceChecks(app),
      ...proofChecks(app),
      ...(await schemaChecks(app, cache)),
      ...(await generatedChecks(app)),
    ];
    const pass = checks.every((c) => c.pass);
    failed ||= !pass;
    const a = appsConfig().apps[app]!;
    const result = {
      app,
      title: a.title,
      owner: a.owner,
      pass,
      checks,
      generated_at: new Date().toISOString(),
    };
    writeFileSync(join(out, `${app}.json`), `${JSON.stringify(result, null, 1)}\n`);
    writeFileSync(join(out, `${app}.md`), markdown(app, checks));
    summary[app] = result;
    console.log(`${app}: ${pass ? "ready" : "NOT READY"}`);
    for (const c of checks) console.log(`  ${c.pass ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`);
  }
  if (!want) writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
  if (failed) process.exitCode = 1;
}

await main();
