// Shot log and target inventory. Every query runs as the caller, so a scientist without clearance never
// sees a restricted campaign or shot: not in lists, not in search results, not in counts, and a direct
// link answers 404 rather than 403, which would confirm the record exists.
import { PG, pgCode } from "@rop/db";
import { AppError, platformConfig } from "@rop/platform";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Deps, notFound, route } from "../http";

const uuid = z.uuid();
const IdParams = z.object({ id: uuid });
const Classification = z.enum(["internal", "restricted"]);

export function shotlogRoutes(app: FastifyInstance, deps: Deps): void {
  const cfg = platformConfig();

  route(app, deps, {
    method: "GET",
    url: "/api/shotlog/campaigns",
    app: "shotlog",
    summary: "Campaigns you can see, newest first, with shot counts",
    handler: ({ db }) =>
      db(
        async (c) =>
          (
            await c.query(
              `SELECT c.id, c.code, c.title, c.facility, c.entity, c.classification, c.lead_id, p.display_name AS lead_name,
                      c.starts_on, c.ends_on,
                      (SELECT count(*)::int FROM shots s WHERE s.campaign_id = c.id AND s.corrects IS NULL) AS shots,
                      (SELECT max(s.fired_at) FROM shots s WHERE s.campaign_id = c.id) AS last_shot_at
                 FROM campaigns c JOIN people p ON p.id = c.lead_id
                ORDER BY c.starts_on DESC, c.code`,
            )
          ).rows,
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/campaigns",
    app: "shotlog",
    summary: "Create a campaign you lead",
    roles: ["Scientist"],
    status: 201,
    body: z.object({
      code: z.string().regex(/^[A-Z0-9-]{3,20}$/),
      title: z.string().min(3).max(200),
      facility: z.string().min(2).max(200),
      entity: z.enum(["DE", "US"]),
      classification: Classification,
      starts_on: z.iso.date(),
      ends_on: z.iso.date().nullable().default(null),
    }),
    handler: ({ db, body, principal }) =>
      db(async (c) => {
        const r = await c.query(
          `INSERT INTO campaigns (code, title, facility, entity, classification, lead_id, starts_on, ends_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            body.code,
            body.title,
            body.facility,
            body.entity,
            body.classification,
            principal.personId,
            body.starts_on,
            body.ends_on,
          ],
        );
        await c.query("INSERT INTO campaign_members (campaign_id, person_id, role) VALUES ($1, $2, 'lead')", [
          r.rows[0].id,
          principal.personId,
        ]);
        return { id: r.rows[0].id };
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/shotlog/campaigns/:id",
    app: "shotlog",
    summary: "One campaign with its members",
    params: IdParams,
    handler: ({ db, params }) =>
      db(
        async (c) => {
          const r = await c.query(
            `SELECT c.*, p.display_name AS lead_name FROM campaigns c JOIN people p ON p.id = c.lead_id WHERE c.id = $1`,
            [params.id],
          );
          if (!r.rowCount) throw notFound("Campaign");
          const members = await c.query(
            `SELECT m.person_id, m.role, p.display_name FROM campaign_members m JOIN people p ON p.id = m.person_id
              WHERE m.campaign_id = $1 ORDER BY m.role, p.display_name`,
            [params.id],
          );
          return { ...r.rows[0], members: members.rows };
        },
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/campaigns/:id/members",
    app: "shotlog",
    summary: "Add someone to a campaign you lead",
    params: IdParams,
    status: 201,
    body: z.object({ person_id: uuid, role: z.enum(["operator", "observer"]) }),
    handler: ({ db, params, body }) =>
      db(async (c) => {
        await c.query("INSERT INTO campaign_members (campaign_id, person_id, role) VALUES ($1, $2, $3)", [
          params.id,
          body.person_id,
          body.role,
        ]);
        return { ok: true };
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/shotlog/campaigns/:id/shots",
    app: "shotlog",
    summary: "The campaign's shots, latest first; each shows its latest correction",
    params: IdParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(cfg.api.page_size_max).default(cfg.api.page_size_default),
    }),
    handler: ({ db, params, query }) =>
      db(
        async (c) => {
          const camp = await c.query("SELECT id FROM campaigns WHERE id = $1", [params.id]);
          if (!camp.rowCount) throw notFound("Campaign");
          const r = await c.query(
            `SELECT o.id, o.shot_no, o.fired_at, o.target_id, t.serial AS target_serial, o.logged_by, p.display_name AS logged_by_name,
                    o.logged_at, o.classification,
                    coalesce(k.energy_j, o.energy_j) AS energy_j, coalesce(k.pulse_ns, o.pulse_ns) AS pulse_ns,
                    coalesce(k.outcome, o.outcome) AS outcome, coalesce(k.notes, o.notes) AS notes,
                    k.id AS corrected_by, (SELECT count(*)::int FROM shots x WHERE x.corrects = o.id) AS corrections
               FROM shots o
               JOIN people p ON p.id = o.logged_by
               LEFT JOIN targets t ON t.id = o.target_id
               LEFT JOIN LATERAL (SELECT * FROM shots k WHERE k.corrects = o.id ORDER BY k.logged_at DESC, k.id DESC LIMIT 1) k ON true
              WHERE o.campaign_id = $1 AND o.corrects IS NULL
              ORDER BY o.shot_no DESC LIMIT $2`,
            [params.id, query.limit],
          );
          return r.rows;
        },
        { readOnly: true },
      ),
  });

  const ShotBody = z.object({
    fired_at: z.iso.datetime({ offset: true }),
    target_id: uuid.nullable().default(null),
    energy_j: z.number().min(0).max(1e6).nullable().default(null),
    pulse_ns: z.number().positive().max(1e6).nullable().default(null),
    outcome: z.enum(["nominal", "partial", "misfire", "aborted"]),
    notes: z.string().max(cfg.shotlog.max_notes_chars).default(""),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/campaigns/:id/shots",
    app: "shotlog",
    summary: "Log the campaign's next shot; the number is assigned here",
    params: IdParams,
    status: 201,
    body: ShotBody,
    handler: async ({ db, params, body, principal, telemetry }) => {
      // Two operators logging at the same moment must get different numbers. The advisory lock serialises
      // them; the unique index is the backstop, and a conflict is retried once with a fresh number.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await db(async (c) => {
            const camp = await c.query("SELECT classification FROM campaigns WHERE id = $1", [params.id]);
            if (!camp.rowCount) throw notFound("Campaign");
            await c.query("SELECT pg_advisory_xact_lock(hashtextextended('shots:' || $1, 0))", [params.id]);
            const next = await c.query(
              "SELECT coalesce(max(shot_no), 0) + 1 AS n FROM shots WHERE campaign_id = $1",
              [params.id],
            );
            const r = await c.query(
              `INSERT INTO shots (campaign_id, shot_no, fired_at, target_id, energy_j, pulse_ns, outcome, notes, classification, logged_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, shot_no`,
              [
                params.id,
                next.rows[0].n,
                body.fired_at,
                body.target_id,
                body.energy_j,
                body.pulse_ns,
                body.outcome,
                body.notes,
                camp.rows[0].classification,
                principal.personId,
              ],
            );
            return r.rows[0];
          });
        } catch (err) {
          if (pgCode(err) === PG.uniqueViolation && attempt === 0) {
            telemetry.counter("shotlog_shot_conflicts_total", 1, { campaign: params.id });
            continue;
          }
          throw err;
        }
      }
      throw new AppError(409, "busy", "Another shot was logged at the same time; try again.");
    },
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/shots/:id/corrections",
    app: "shotlog",
    summary: "Correct a shot entry; the original stays in the record",
    params: IdParams,
    status: 201,
    body: ShotBody.omit({ target_id: true, fired_at: true }).extend({ reason: z.string().min(3).max(500) }),
    handler: ({ db, params, body, principal }) =>
      db(async (c) => {
        const o = await c.query("SELECT * FROM shots WHERE id = $1 AND corrects IS NULL", [params.id]);
        if (!o.rowCount) throw notFound("Shot");
        const orig = o.rows[0];
        const r = await c.query(
          `INSERT INTO shots (campaign_id, shot_no, fired_at, target_id, energy_j, pulse_ns, outcome, notes, classification, logged_by, corrects)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            orig.campaign_id,
            orig.shot_no,
            orig.fired_at,
            orig.target_id,
            body.energy_j,
            body.pulse_ns,
            body.outcome,
            `${body.notes}\n\nCorrection: ${body.reason}`.trim(),
            orig.classification,
            principal.personId,
            orig.id,
          ],
        );
        return { id: r.rows[0].id };
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/shotlog/search",
    app: "shotlog",
    summary: "Full-text search over the shots you can see",
    query: z.object({ q: z.string().trim().min(cfg.search.min_query_chars).max(200) }),
    handler: ({ db, query }) =>
      db(
        async (c) =>
          (
            await c.query(
              `SELECT s.id, s.campaign_id, c.code AS campaign_code, s.shot_no, s.fired_at, s.outcome, s.corrects,
                      ts_headline('english', s.notes, q, 'MaxFragments=1, MaxWords=18, MinWords=6') AS snippet,
                      ts_rank(s.search, q) AS rank
                 FROM shots s JOIN campaigns c ON c.id = s.campaign_id, websearch_to_tsquery('english', $1) q
                WHERE s.search @@ q
                ORDER BY rank DESC, s.fired_at DESC LIMIT $2`,
              [query.q, cfg.search.max_results],
            )
          ).rows,
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/shotlog/targets",
    app: "shotlog",
    summary: "Target inventory, optionally by status",
    query: z.object({
      status: z.enum(["fabricated", "characterized", "allocated", "shot", "scrapped"]).optional(),
    }),
    handler: ({ db, query }) =>
      db(
        async (c) =>
          (
            await c.query(
              `SELECT t.id, t.serial, t.batch, t.design, t.status, t.campaign_id, c.code AS campaign_code, t.characterization, t.updated_at
                 FROM targets t LEFT JOIN campaigns c ON c.id = t.campaign_id
                WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t.status, t.serial`,
              [query.status ?? null],
            )
          ).rows,
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/targets",
    app: "shotlog",
    summary: "Register newly fabricated targets",
    roles: ["Scientist"],
    status: 201,
    body: z.object({
      batch: z.string().min(1).max(40),
      design: z.string().min(1).max(120),
      serials: z
        .array(z.string().regex(/^[A-Z0-9-]{3,30}$/))
        .min(1)
        .max(200),
    }),
    handler: ({ db, body }) =>
      db(async (c) => {
        const r = await c.query(
          `INSERT INTO targets (serial, batch, design, status)
           SELECT s, $2, $3, 'fabricated' FROM unnest($1::text[]) s RETURNING id, serial`,
          [body.serials, body.batch, body.design],
        );
        return r.rows;
      }),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/shotlog/targets/:id/transition",
    app: "shotlog",
    summary: "Move a target through its life: characterise, allocate to a campaign, release or scrap",
    params: IdParams,
    body: z.object({
      to: z.enum(["characterized", "allocated", "scrapped"]),
      campaign_id: uuid.optional(),
      characterization: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
    handler: ({ db, params, body }) =>
      db(async (c) => {
        if (body.to === "allocated" && !body.campaign_id)
          throw new AppError(400, "invalid-request", "Allocating needs a campaign.");
        if (body.to === "allocated") {
          const camp = await c.query("SELECT 1 FROM campaigns WHERE id = $1", [body.campaign_id]);
          if (!camp.rowCount) throw notFound("Campaign");
        }
        const r = await c.query(
          `UPDATE targets SET status = $2,
                  campaign_id = CASE WHEN $2 = 'allocated' THEN $3::uuid ELSE NULL END,
                  characterization = characterization || coalesce($4::jsonb, '{}'::jsonb)
            WHERE id = $1 RETURNING id, status, campaign_id`,
          [
            params.id,
            body.to,
            body.campaign_id ?? null,
            body.characterization ? JSON.stringify(body.characterization) : null,
          ],
        );
        if (!r.rowCount) throw notFound("Target");
        return r.rows[0];
      }),
  });
}
