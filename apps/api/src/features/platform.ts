// Routes every app shares: who am I, the access model as data for the "who can see what" view, and the
// generated reports (access proof, handover gate) for the console.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accessModel } from "@rop/access";
import { AppError, appsConfig, ROOT } from "@rop/platform";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Deps, route } from "../http";

function report(path: string): unknown {
  const p = join(ROOT, "reports", path);
  if (!existsSync(p))
    throw new AppError(
      404,
      "not-generated",
      `reports/${path} has not been generated yet; run pnpm proof or pnpm handover.`,
    );
  return JSON.parse(readFileSync(p, "utf8"));
}

export function platformRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET",
    url: "/api/me",
    app: "platform",
    summary: "The signed-in person, their roles and the apps they can use",
    handler: ({ db, principal }) =>
      db(
        async (c) => {
          const me = await c.query("SELECT id, display_name, email, entity, team FROM people WHERE id = $1", [
            principal.personId,
          ]);
          const apps = Object.entries(appsConfig().apps).map(([key, a]) => ({
            key,
            title: a.title,
            owner: a.owner.team,
          }));
          return { ...me.rows[0], roles: principal.roles, apps };
        },
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/access/model",
    app: "platform",
    summary: "The access model: roles, data classes and the rules of every table",
    handler: async () => {
      const m = accessModel();
      return { roles: m.roles, data_classes: m.data_classes, tables: m.tables };
    },
  });

  route(app, deps, {
    method: "GET",
    url: "/api/reports/:name",
    app: "platform",
    summary: "A generated report: the access proof or the handover gate",
    params: z.object({ name: z.enum(["access-proof", "handover", "heldout"]) }),
    handler: async ({ params }) =>
      report(
        {
          "access-proof": "access/proof.json",
          handover: "handover/summary.json",
          heldout: "heldout/blind-1/first_run.json",
        }[params.name],
      ),
  });
}
