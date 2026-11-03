// The OpenAPI document, built from the routes as they are registered (apps/api/src/http.ts) and their zod
// schemas, so the document cannot drift from the code.
import { DevIssuer } from "@rop/auth";
import { createTelemetry } from "@rop/observability";
import type pg from "pg";
import { z } from "zod";
import { registry } from "../apps/api/src/http";
import { buildServer } from "../apps/api/src/server";

export async function openApiDocument() {
  if (!registry.length) {
    const telemetry = createTelemetry("openapi");
    const app = await buildServer({ pool: {} as pg.Pool, verifier: await DevIssuer.create(), telemetry });
    await app.close();
    await telemetry.shutdown();
  }
  const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of [...registry].sort(
    // Code-point order, not locale order: the document must be identical on every machine.
    (a, b) =>
      a.url < b.url ? -1 : a.url > b.url ? 1 : a.method < b.method ? -1 : a.method > b.method ? 1 : 0,
  )) {
    const path = r.url.replace(/:([a-z_]+)/g, "{$1}");
    const parameters: unknown[] = [];
    for (const [where, s] of [
      ["path", r.params],
      ["query", r.query],
    ] as const) {
      if (!s) continue;
      const js = schema(s) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, p] of Object.entries(js.properties ?? {})) {
        parameters.push({
          name,
          in: where,
          required: where === "path" || (js.required ?? []).includes(name),
          schema: p,
        });
      }
    }
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      summary: r.summary,
      tags: [r.app],
      ...(r.roles
        ? {
            description: `Needs one of the roles: ${r.roles.join(", ")}. Row-level security decides the rest.`,
          }
        : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(r.body
        ? { requestBody: { required: true, content: { "application/json": { schema: schema(r.body) } } } }
        : {}),
      responses: {
        [String(r.status)]: { description: r.status === 204 ? "Done" : "OK" },
        default: {
          description: "An RFC 9457 problem",
          content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
        },
      },
      security: [{ entra: [] }],
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Research operations platform API",
      version: "1.0.0",
      description:
        "Internal apps on one platform: shot log and target inventory, grant time and cost reporting.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        entra: { type: "http", scheme: "bearer", bearerFormat: "Microsoft Entra ID access token" },
      },
      schemas: {
        Problem: {
          type: "object",
          required: ["type", "title", "status"],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string", description: "the request id" },
          },
        },
      },
    },
    paths,
  };
}
