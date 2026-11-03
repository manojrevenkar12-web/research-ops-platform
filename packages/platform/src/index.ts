// Shared configuration loading. Every setting lives in config/*.yaml and is validated here once; code
// imports the typed result and never hard-codes a threshold.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

/** The repository root (config/ lives there). A bundled deployment sets ROP_ROOT to where it copied config/. */
export const ROOT = process.env.ROP_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readYaml(name: string): unknown {
  return parse(readFileSync(join(ROOT, "config", name), "utf8"));
}

/** Replace ${NAME} with the environment variable, or keep the placeholder when it is not set. */
export function substituteEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => env[name] ?? whole);
}

const PlatformSchema = z.object({
  api: z.object({
    port: z.number().int().positive(),
    body_limit_bytes: z.number().int().positive(),
    request_timeout_ms: z.number().int().positive(),
    page_size_default: z.number().int().positive(),
    page_size_max: z.number().int().positive(),
  }),
  database: z.object({
    pool_max: z.number().int().positive(),
    statement_timeout_ms: z.number().int().positive(),
    idle_in_transaction_timeout_ms: z.number().int().positive(),
    runtime_role: z.string().min(1),
  }),
  auth: z.object({
    issuer: z.string(),
    audience: z.string(),
    jwks_uri: z.string(),
    clock_tolerance_s: z.number().int().nonnegative(),
    dev_issuer: z.string(),
  }),
  search: z.object({
    max_results: z.number().int().positive(),
    min_query_chars: z.number().int().positive(),
  }),
  shotlog: z.object({ max_notes_chars: z.number().int().positive() }),
  observability: z.object({ service_name: z.string(), slow_request_ms: z.number().int().positive() }),
});
export type PlatformConfig = z.infer<typeof PlatformSchema>;

const GrantsSchema = z.object({
  time_recording: z.object({
    max_hours_per_day: z.number().positive(),
    contemporaneous_days: z.number().int().nonnegative(),
    late_entries_eligible: z.boolean(),
    period: z.literal("month"),
  }),
  methods: z.object({
    eu_daily: z.object({
      days_per_year: z.number().positive(),
      day_equivalent_hours: z.number().positive(),
      cap_days_per_person_year: z.number().positive(),
    }),
    de_hourly: z.object({
      divide_by: z.literal("max_of_contract_and_actual"),
      managing_director_max_hourly_eur: z.number().positive(),
    }),
  }),
  money: z.object({ currency: z.literal("EUR"), rounding: z.literal("half_up_cents") }),
  reporting: z.object({ min_group_size: z.number().int().positive() }),
});
export type GrantsConfig = z.infer<typeof GrantsSchema>;

const AlertSchema = z.object({
  metric: z.string(),
  filter: z.record(z.string(), z.string()).optional(),
  condition: z.enum(["rate_over_total", "p95", "count", "last"]),
  threshold: z.number(),
  window_minutes: z.number().int().positive(),
  severity: z.number().int().min(0).max(4),
  runbook_anchor: z.string(),
});
const AlertsSchema = z.object({ alerts: z.record(z.string(), AlertSchema) });
export type AlertsConfig = z.infer<typeof AlertsSchema>;

const AppSchema = z.object({
  title: z.string(),
  for: z.string(),
  owner: z.object({ team: z.string(), contact: z.string() }),
  tables: z.array(z.string()).min(1),
  routes_prefix: z.string().startsWith("/api/"),
  runbook: z.string(),
  alerts: z.array(z.string()),
});
const AppsSchema = z.object({
  apps: z.record(z.string(), AppSchema),
  handover: z.object({
    runbook_sections: z.array(z.string()).min(1),
    min_route_test_coverage: z.number().min(0).max(1),
    require_reversible_migrations: z.boolean(),
    require_access_proof: z.boolean(),
  }),
});
export type AppsConfig = z.infer<typeof AppsSchema>;

let platform: PlatformConfig | undefined;
let grants: GrantsConfig | undefined;
let alerts: AlertsConfig | undefined;
let apps: AppsConfig | undefined;

export function platformConfig(): PlatformConfig {
  platform ??= PlatformSchema.parse(readYaml("platform.yaml"));
  return platform;
}
export function grantsConfig(): GrantsConfig {
  grants ??= GrantsSchema.parse(readYaml("grants.yaml"));
  return grants;
}
export function alertsConfig(): AlertsConfig {
  alerts ??= AlertsSchema.parse(readYaml("alerts.yaml"));
  return alerts;
}
export function appsConfig(): AppsConfig {
  apps ??= AppsSchema.parse(readYaml("apps.yaml"));
  return apps;
}

export function rawConfig(name: string): unknown {
  return readYaml(name);
}

/** Errors that are the caller's fault carry an HTTP status and a stable type for problem+json. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
