// Grant time recording, approvals and cost reporting. Who may do what is decided by row security and the
// time-entry triggers (config/access.yaml, migrations/0003); these handlers shape requests and answers.
import { computeGrantCost, GrantNotFoundError, MissingSalaryError, writeSnapshot } from "@rop/costs";
import { AppError, grantsConfig } from "@rop/platform";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Deps, notFound, route } from "../http";

const uuid = z.uuid();
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Hours = z.number().positive().max(24).multipleOf(0.25);

const ENTRY_COLUMNS = `e.id, e.person_id, p.display_name AS person_name, to_char(e.work_date, 'YYYY-MM-DD') AS work_date,
  e.work_package_id, wp.code AS work_package_code, e.grant_id, g.code AS grant_code, e.activity, e.hours::float AS hours,
  e.status, e.approved_by, e.approved_at, e.recorded_at, e.late, e.note`;
const ENTRY_FROM = `time_entries e JOIN people p ON p.id = e.person_id
  LEFT JOIN work_packages wp ON wp.id = e.work_package_id LEFT JOIN grants g ON g.id = e.grant_id`;

export function grantsRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET",
    url: "/api/grants",
    app: "grants",
    summary: "Grants with their work packages and your role on each",
    handler: ({ db, principal }) =>
      db(
        async (c) =>
          (
            await c.query(
              `SELECT g.id, g.code, g.title, g.funder, g.method, g.entity, g.starts_on, g.ends_on,
                      (SELECT role FROM grant_members m WHERE m.grant_id = g.id AND m.person_id = $1) AS my_role,
                      (SELECT count(*)::int FROM grant_members m WHERE m.grant_id = g.id) AS members,
                      coalesce((SELECT json_agg(json_build_object('id', wp.id, 'code', wp.code, 'title', wp.title) ORDER BY wp.code)
                                  FROM work_packages wp WHERE wp.grant_id = g.id), '[]') AS work_packages
                 FROM grants g ORDER BY g.code`,
              [principal.personId],
            )
          ).rows,
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/grants/timesheet",
    app: "grants",
    summary: "Your entries between two dates and the work packages you can book to",
    query: z
      .object({ from: z.iso.date(), to: z.iso.date() })
      .refine((q) => q.from <= q.to, "from must not be after to")
      .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 62, "at most 62 days at a time"),
    handler: ({ db, query, principal }) =>
      db(
        async (c) => {
          const entries = await c.query(
            `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM} WHERE e.person_id = $1 AND e.work_date BETWEEN $2 AND $3
              ORDER BY e.work_date, e.recorded_at`,
            [principal.personId, query.from, query.to],
          );
          const bookable = await c.query(
            `SELECT wp.id, wp.code, wp.title, g.id AS grant_id, g.code AS grant_code, g.starts_on, g.ends_on
               FROM work_packages wp JOIN grants g ON g.id = wp.grant_id
               JOIN grant_members m ON m.grant_id = g.id AND m.person_id = $1
              WHERE g.ends_on >= $2 AND g.starts_on <= $3 ORDER BY g.code, wp.code`,
            [principal.personId, query.from, query.to],
          );
          const closed = await c.query(
            "SELECT grant_id, period FROM cost_periods WHERE status = 'closed' AND period BETWEEN to_char($1::date, 'YYYY-MM') AND to_char($2::date, 'YYYY-MM')",
            [query.from, query.to],
          );
          const t = grantsConfig().time_recording;
          return {
            entries: entries.rows,
            bookable: bookable.rows,
            closed_periods: closed.rows,
            rules: { max_hours_per_day: t.max_hours_per_day, contemporaneous_days: t.contemporaneous_days },
          };
        },
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/grants/time-entries",
    app: "grants",
    summary: "Record hours, optionally submitting them straight away",
    status: 201,
    body: z.object({
      work_date: z.iso.date(),
      work_package_id: uuid.nullable().default(null),
      activity: z.string().trim().min(1).max(500),
      hours: Hours,
      note: z.string().max(1000).default(""),
      submit: z.boolean().default(false),
    }),
    handler: ({ db, body, principal }) =>
      db(async (c) => {
        const r = await c.query(
          `INSERT INTO time_entries (person_id, work_date, work_package_id, activity, hours, note, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, status, late, grant_id`,
          [
            principal.personId,
            body.work_date,
            body.work_package_id,
            body.activity,
            body.hours,
            body.note,
            body.submit ? "submitted" : "draft",
          ],
        );
        return r.rows[0];
      }),
  });

  route(app, deps, {
    method: "PATCH",
    url: "/api/grants/time-entries/:id",
    app: "grants",
    summary: "Change one of your draft or returned entries",
    params: z.object({ id: uuid }),
    body: z
      .object({
        work_date: z.iso.date(),
        work_package_id: uuid.nullable(),
        activity: z.string().trim().min(1).max(500),
        hours: Hours,
        note: z.string().max(1000),
      })
      .partial()
      .refine((b) => Object.keys(b).length > 0, "nothing to change"),
    handler: ({ db, params, body }) =>
      db(async (c) => {
        const cols = Object.keys(body) as (keyof typeof body)[];
        const r = await c.query(
          `UPDATE time_entries SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, status = 'draft'
            WHERE id = $1 AND status IN ('draft', 'returned') RETURNING id, status, late`,
          [params.id, ...cols.map((k) => body[k])],
        );
        if (!r.rowCount) throw notFound("Editable entry");
        return r.rows[0];
      }),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/grants/time-entries/:id/submit",
    app: "grants",
    summary: "Submit one of your entries for approval",
    params: z.object({ id: uuid }),
    handler: ({ db, params, principal }) =>
      db(async (c) => {
        const r = await c.query(
          "UPDATE time_entries SET status = 'submitted' WHERE id = $1 AND person_id = $2 AND status IN ('draft', 'returned') RETURNING id, status",
          [params.id, principal.personId],
        );
        if (!r.rowCount) throw notFound("Entry to submit");
        return r.rows[0];
      }),
  });

  route(app, deps, {
    method: "DELETE",
    url: "/api/grants/time-entries/:id",
    app: "grants",
    summary: "Delete one of your draft entries",
    params: z.object({ id: uuid }),
    status: 204,
    handler: ({ db, params }) =>
      db(async (c) => {
        const r = await c.query("DELETE FROM time_entries WHERE id = $1 AND status = 'draft'", [params.id]);
        if (!r.rowCount) throw notFound("Draft entry");
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/grants/approvals",
    app: "grants",
    summary: "Entries waiting for your decision on the grants you lead",
    handler: ({ db, principal }) =>
      db(
        async (c) =>
          (
            await c.query(
              `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
                WHERE e.status = 'submitted' AND e.person_id <> $1
                  AND EXISTS (SELECT 1 FROM grant_members m WHERE m.grant_id = e.grant_id AND m.person_id = $1 AND m.role = 'lead')
                ORDER BY e.work_date, p.display_name`,
              [principal.personId],
            )
          ).rows,
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/grants/time-entries/:id/decision",
    app: "grants",
    summary: "Approve or return someone's submitted entry on a grant you lead",
    params: z.object({ id: uuid }),
    body: z.discriminatedUnion("decision", [
      z.object({ decision: z.literal("approve") }),
      z.object({ decision: z.literal("return"), reason: z.string().trim().min(3).max(500) }),
    ]),
    handler: ({ db, params, body }) =>
      db(async (c) => {
        const r = await c.query(
          `UPDATE time_entries SET status = $2 WHERE id = $1 AND status = 'submitted' RETURNING id, status, approved_by, approved_at`,
          [params.id, body.decision === "approve" ? "approved" : "returned"],
        );
        if (!r.rowCount) throw notFound("Submitted entry");
        if (body.decision === "return") {
          await c.query("INSERT INTO outbox (topic, payload) VALUES ('time.returned', $1)", [
            JSON.stringify({ entry_id: params.id, reason: body.reason }),
          ]);
        }
        return r.rows[0];
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/grants/:id/cost",
    app: "grants",
    summary: "Personnel cost of a grant in a month, per person (Finance)",
    roles: ["Finance"],
    params: z.object({ id: uuid }),
    query: z.object({ period: Period }),
    handler: ({ db, params, query }) =>
      db(
        async (c) => {
          try {
            return await computeGrantCost(c, params.id, query.period);
          } catch (err) {
            if (err instanceof GrantNotFoundError) throw notFound("Grant");
            if (err instanceof MissingSalaryError) {
              throw new AppError(409, "missing-personnel-cost", err.message, {
                people: err.people,
                year: err.year,
              });
            }
            throw err;
          }
        },
        { readOnly: true },
      ),
  });

  route(app, deps, {
    method: "POST",
    url: "/api/grants/:id/periods/:period/close",
    app: "grants",
    summary: "Compute the month's figures and close it for good (Finance)",
    roles: ["Finance"],
    params: z.object({ id: uuid, period: Period }),
    handler: ({ db, params }) =>
      db(async (c) => {
        const open = await c.query(
          "SELECT 1 FROM time_entries WHERE grant_id = $1 AND to_char(work_date, 'YYYY-MM') = $2 AND status IN ('draft', 'submitted', 'returned')",
          [params.id, params.period],
        );
        if (open.rowCount) {
          throw new AppError(
            409,
            "undecided-entries",
            `${open.rowCount} entries of this month are not approved yet.`,
            { undecided: open.rowCount },
          );
        }
        let result: Awaited<ReturnType<typeof computeGrantCost>>;
        try {
          result = await computeGrantCost(c, params.id, params.period);
        } catch (err) {
          if (err instanceof GrantNotFoundError) throw notFound("Grant");
          if (err instanceof MissingSalaryError)
            throw new AppError(409, "missing-personnel-cost", err.message, { people: err.people });
          throw err;
        }
        await writeSnapshot(c, result);
        await c.query(
          `INSERT INTO cost_periods (grant_id, period, status) VALUES ($1, $2, 'open') ON CONFLICT (grant_id, period) DO NOTHING`,
          [params.id, params.period],
        );
        const closed = await c.query(
          "UPDATE cost_periods SET status = 'closed' WHERE grant_id = $1 AND period = $2 RETURNING closed_at",
          [params.id, params.period],
        );
        if (!closed.rowCount) throw notFound("Cost period");
        await c.query("INSERT INTO outbox (topic, payload) VALUES ('grant.period_closed', $1)", [
          JSON.stringify({ grant_id: params.id, period: params.period, funded_eur: result.funded_eur }),
        ]);
        return { ...result, closed_at: closed.rows[0].closed_at };
      }),
  });

  route(app, deps, {
    method: "GET",
    url: "/api/grants/reporting",
    app: "grants",
    summary: "Grant totals by month; a total over too few people is withheld from Executive",
    roles: ["Finance", "Executive"],
    handler: ({ db }) =>
      db(
        async (c) => {
          const periods = await c.query(
            `SELECT g.id AS grant_id, g.code, g.title, g.funder, cp.period, cp.status,
                    s.direct_eur, s.indirect_eur, s.funded_eur, s.ineligible_hours, s.contributors, s.computed_at
               FROM cost_periods cp JOIN grants g ON g.id = cp.grant_id
               LEFT JOIN grant_cost_snapshots s ON s.grant_id = cp.grant_id AND s.period = cp.period
              ORDER BY g.code, cp.period DESC`,
          );
          const min = grantsConfig().reporting.min_group_size;
          // A missing snapshot row means row security withheld it (too few people) or it was never computed.
          return {
            min_group_size: min,
            rows: periods.rows.map((r) => ({ ...r, withheld: r.direct_eur === null })),
          };
        },
        { readOnly: true },
      ),
  });
}
