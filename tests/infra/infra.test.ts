// Policy checks on the OpenTofu code that run without Azure: the properties a reviewer would otherwise have
// to remember. CI also runs `tofu fmt -check` and `tofu validate` against the real providers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@cdktf/hcl2json";
import { METRICS } from "@rop/observability";
import { alertsConfig, ROOT } from "@rop/platform";
import { beforeAll, describe, expect, it } from "vitest";

type Block = Record<string, unknown>;
const INFRA = join(ROOT, "infra");
const resources: Record<string, Record<string, Block>> = {};
const sources: Record<string, string> = {};

const one = (type: string, name: string): Block => {
  const r = resources[type]?.[name];
  if (!r) throw new Error(`missing ${type}.${name}`);
  return r;
};
const first = (b: Block, key: string) => (b[key] as Block[])[0]!;

beforeAll(async () => {
  for (const f of readdirSync(INFRA).filter((x) => x.endsWith(".tf"))) {
    const text = readFileSync(join(INFRA, f), "utf8");
    sources[f] = text;
    const j = (await parse(f, text)) as { resource?: Record<string, Record<string, Block[]>> };
    for (const [type, byName] of Object.entries(j.resource ?? {})) {
      for (const [name, blocks] of Object.entries(byName)) {
        resources[type] ??= {};
        resources[type][name] = blocks[0]!;
      }
    }
  }
});

describe("infrastructure as code", () => {
  it("PostgreSQL is private, signs in with Entra ID only, and keeps backups", () => {
    const pg = one("azurerm_postgresql_flexible_server", "main");
    expect(pg.public_network_access_enabled).toBe(false);
    expect(first(pg, "authentication")).toMatchObject({
      active_directory_auth_enabled: true,
      password_auth_enabled: false,
    });
    expect(pg.backup_retention_days).toBe("${var.backup_retention_days}");
    expect(pg.geo_redundant_backup_enabled).toBe('${var.environment == "prod"}');
    expect(one("azurerm_postgresql_flexible_server_configuration", "require_tls").value).toBe("on");
  });

  it("no password, key or connection secret is written in the code", () => {
    for (const [f, text] of Object.entries(sources)) {
      expect(text, f).not.toMatch(
        /administrator_password|admin_password|password\s*=\s*"|primary_access_key|client_secret/,
      );
    }
    expect(one("azurerm_storage_account", "functions").shared_access_key_enabled).toBe(false);
  });

  it("the runtimes use managed identities, and the database URL carries no password", () => {
    const api = one("azurerm_container_app", "api");
    expect(first(api, "identity").type).toBe("UserAssigned");
    const env = first(first(api, "template"), "container").env as { name: string; value: string }[];
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName.AUTH_MODE).toBe("entra");
    expect(byName.NODE_ENV).toBe("production");
    expect(byName.ROP_DB_AUTH).toBe("entra");
    expect(byName.ROP_APP_DATABASE_URL).not.toMatch(/:[^@/]+@/);
    expect(one("azurerm_function_app_flex_consumption", "jobs").storage_authentication_type).toBe(
      "UserAssignedIdentity",
    );
  });

  it("Key Vault uses RBAC, keeps deleted secrets and is not public", () => {
    const kv = one("azurerm_key_vault", "main");
    expect(kv).toMatchObject({
      rbac_authorization_enabled: true,
      purge_protection_enabled: true,
      public_network_access_enabled: false,
    });
  });

  it("the API image must be pinned by digest", () => {
    expect(sources["variables.tf"]).toMatch(/@sha256:\[0-9a-f\]\{64\}\$/);
  });

  it("every taggable resource carries the platform's tags", () => {
    const untaggable = new Set([
      "azurerm_subnet",
      "azurerm_postgresql_flexible_server_database",
      "azurerm_postgresql_flexible_server_active_directory_administrator",
      "azurerm_postgresql_flexible_server_configuration",
      "azurerm_monitor_diagnostic_setting",
      "azurerm_role_assignment",
      "azurerm_storage_container",
      "azuread_application",
      "azuread_service_principal",
      "random_uuid",
    ]);
    for (const [type, byName] of Object.entries(resources)) {
      if (untaggable.has(type)) continue;
      for (const [name, r] of Object.entries(byName)) expect(r.tags, `${type}.${name}`).toBe("${local.tags}");
    }
  });

  it("app roles and alerts come from config, and every alert reads a metric the code emits", () => {
    const roles = JSON.parse(readFileSync(join(INFRA, "app_roles.auto.tfvars.json"), "utf8"));
    expect(roles.app_roles.map((r: { value: string }) => r.value)).toContain("RestrictedTechnical");
    expect(roles.app_roles.find((r: { value: string }) => r.value === "Platform").member_types).toEqual([
      "Application",
    ]);
    for (const [name, a] of Object.entries(alertsConfig().alerts)) {
      expect(Object.keys(METRICS), name).toContain(a.metric);
    }
  });

  it("the app registration asks for the idtyp claim the API uses to refuse application tokens", () => {
    expect(sources["identity.tf"]).toMatch(/name = "idtyp"/);
    expect(one("azuread_service_principal", "api").app_role_assignment_required).toBe(true);
  });
});
