import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, describeError } from "../../shared/lib/api";
import { addDays, formatDayShort, formatNumber, mondayOf, today } from "../../shared/lib/format";
import { Badge, Button, Field, Notice, Page, Panel, QueryView } from "../../shared/ui";

export interface Entry {
  id: string;
  work_date: string;
  work_package_id: string | null;
  work_package_code: string | null;
  grant_code: string | null;
  activity: string;
  hours: number;
  status: "draft" | "submitted" | "approved" | "returned";
  late: boolean;
  person_name: string;
  return_reason: string | null;
}

interface Timesheet {
  entries: Entry[];
  bookable: { id: string; code: string; title: string; grant_code: string }[];
  closed_periods: { grant_id: string; period: string }[];
  rules: { max_hours_per_day: number; contemporaneous_days: number };
}

const TONE = { draft: "neutral", submitted: "warn", approved: "ok", returned: "danger" } as const;

export function TimesheetPage() {
  const [week, setWeek] = useState(() => mondayOf(today()));
  const from = week;
  const to = addDays(week, 6);
  const qc = useQueryClient();
  const sheet = useQuery({
    queryKey: ["timesheet", from],
    queryFn: () => api<Timesheet>(`/api/grants/timesheet?from=${from}&to=${to}`),
  });
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["timesheet"] });
  const add = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ late: boolean }>("/api/grants/time-entries", { method: "POST", body }),
    onSuccess: (r) => {
      setNotice(
        r.late
          ? "Recorded. It is marked late: it is kept but not charged to a grant."
          : "Recorded as a draft.",
      );
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "submit" | "delete" }) =>
      action === "submit"
        ? api(`/api/grants/time-entries/${id}/submit`, { method: "POST", body: {} })
        : api(`/api/grants/time-entries/${id}`, { method: "DELETE" }),
    onSuccess: (_r, v) => {
      setNotice(v.action === "submit" ? "Submitted for approval." : "Deleted.");
      refresh();
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    add.mutate({
      work_date: f.get("work_date"),
      work_package_id: f.get("work_package_id") || null,
      activity: f.get("activity"),
      hours: Number(f.get("hours")),
    });
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <Page
      title="My hours"
      lead="Record hours as you go. Funded hours need a lead's approval; hours recorded more than a week late are kept but not charged."
      actions={
        <fieldset className="week">
          <legend className="sr-only">Week</legend>
          <Button variant="secondary" onClick={() => setWeek(addDays(week, -7))}>
            Previous week
          </Button>
          <span className="week__label">
            {formatDayShort(from)} to {formatDayShort(to)}
          </span>
          <Button
            variant="secondary"
            onClick={() => setWeek(addDays(week, 7))}
            disabled={addDays(week, 7) > today()}
          >
            Next week
          </Button>
        </fieldset>
      }
    >
      <QueryView query={sheet} loading="Loading your week">
        {(s) => (
          <div className="stack">
            <div className="days">
              {days.map((d) => {
                const entries = s.entries.filter((e) => e.work_date === d);
                const total = entries.reduce((a, e) => a + e.hours, 0);
                return (
                  <section key={d} className="day" aria-label={formatDayShort(d)}>
                    <h2 className="day__title">
                      {formatDayShort(d)}
                      <span className={`day__total${total > s.rules.max_hours_per_day ? " is-over" : ""}`}>
                        {formatNumber(total)} h
                      </span>
                    </h2>
                    {entries.length === 0 ? (
                      <p className="day__none">No hours</p>
                    ) : (
                      <ul className="entries">
                        {entries.map((e) => (
                          <li key={e.id} className="entry">
                            <span className="entry__hours">{formatNumber(e.hours)} h</span>
                            <span className="entry__what">
                              {e.activity}
                              <span className="entry__wp">
                                {e.grant_code ? `${e.grant_code} ${e.work_package_code}` : "Not funded"}
                              </span>
                              {e.status === "returned" && e.return_reason ? (
                                <span className="entry__reason">Returned: {e.return_reason}</span>
                              ) : null}
                            </span>
                            <span className="entry__state">
                              <Badge tone={TONE[e.status]}>{e.status}</Badge>
                              {e.late ? <Badge tone="warn">late</Badge> : null}
                            </span>
                            {e.status === "draft" || e.status === "returned" ? (
                              <span className="entry__actions">
                                <Button
                                  variant="quiet"
                                  onClick={() => act.mutate({ id: e.id, action: "submit" })}
                                >
                                  Submit
                                </Button>
                                {e.status === "draft" ? (
                                  <Button
                                    variant="quiet"
                                    onClick={() => act.mutate({ id: e.id, action: "delete" })}
                                  >
                                    Delete
                                  </Button>
                                ) : null}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            <Panel title="Record hours">
              <form className="form" onSubmit={submit} aria-label="Record hours">
                <div className="form__row">
                  <Field label="Day">
                    <input
                      name="work_date"
                      type="date"
                      required
                      max={today()}
                      defaultValue={today() < to ? today() : to}
                      className="input"
                    />
                  </Field>
                  <Field
                    label="Work package"
                    hint={s.bookable.length ? undefined : "You are not on a funded grant this week."}
                  >
                    <select name="work_package_id" className="input" defaultValue="">
                      <option value="">Not funded</option>
                      {s.bookable.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.grant_code} {b.code}: {b.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Hours" hint={`Quarter hours; at most ${s.rules.max_hours_per_day} a day.`}>
                    <input
                      name="hours"
                      type="number"
                      step="0.25"
                      min="0.25"
                      max={s.rules.max_hours_per_day}
                      required
                      className="input"
                    />
                  </Field>
                </div>
                <Field label="What you did">
                  <input name="activity" required maxLength={500} className="input" />
                </Field>
                <div className="form__actions">
                  <Button type="submit" busy={add.isPending}>
                    Record hours
                  </Button>
                  <Notice message={notice} />
                  <Notice
                    message={
                      add.isError ? describeError(add.error) : act.isError ? describeError(act.error) : null
                    }
                    tone="danger"
                  />
                </div>
              </form>
            </Panel>
          </div>
        )}
      </QueryView>
    </Page>
  );
}
