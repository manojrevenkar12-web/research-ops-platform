// Who can see what: the generated access proof as a picture. Each cell is how many of a table's fixture rows a
// principal could read in the real database; the numbers above say how the proof was made.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/lib/api";
import { Badge, Page, Panel, QueryView } from "../../shared/ui";

interface Proof {
  generated_at: string;
  summary: {
    principals: number;
    tables: number;
    attempts: number;
    mismatches: number;
    inconclusive: number;
    mutants: number;
    caught: number;
    equivalent: number;
    survived: number;
  };
  visibility: {
    principal: string;
    roles: string[];
    entity: string;
    tables: Record<string, { visible: number; rows: number }>;
  }[];
  mutants: {
    id: string;
    table: string;
    description: string;
    verdict: string;
    reason?: string;
    evidence?: string;
  }[];
}

const SHOWN = [
  "campaigns",
  "shots",
  "targets",
  "time_entries",
  "salary_costs",
  "grant_cost_snapshots",
  "audit_events",
  "outbox",
];

export function AccessPage() {
  const proof = useQuery({ queryKey: ["proof"], queryFn: () => api<Proof>("/api/reports/access-proof") });
  const [table, setTable] = useState<string | null>(null);
  return (
    <Page
      title="Who can see what"
      lead="One access model becomes the database's row-level security. This is what each person and job could actually read when the proof last ran."
    >
      <QueryView query={proof} loading="Loading the access proof">
        {(p) => (
          <div className="stack">
            <dl className="totals">
              <div>
                <dt>Statements tried</dt>
                <dd>{p.summary.attempts.toLocaleString("en-GB")}</dd>
              </div>
              <div className="totals__key">
                <dt>Disagreements with the model</dt>
                <dd>{p.summary.mismatches}</dd>
              </div>
              <div>
                <dt>Weakened rules caught</dt>
                <dd>
                  {p.summary.caught} of {p.summary.mutants}
                </dd>
              </div>
              <div>
                <dt>Equivalent, with reasons</dt>
                <dd>{p.summary.equivalent}</dd>
              </div>
            </dl>
            <div className="table-wrap">
              <table className="table heat">
                <caption>Rows each principal can read, out of the fixture's rows</caption>
                <thead>
                  <tr>
                    <th scope="col">Who</th>
                    {SHOWN.map((t) => (
                      <th key={t} scope="col" className="num">
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => setTable(t)}
                          aria-pressed={table === t}
                        >
                          {t.replaceAll("_", " ")}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.visibility.map((v) => (
                    <tr key={v.principal}>
                      <th scope="row">
                        {v.principal}
                        <span className="cell-sub">
                          {v.roles.filter((r) => r !== "Staff").join(", ") || "Staff"} in {v.entity}
                        </span>
                      </th>
                      {SHOWN.map((t) => {
                        const c = v.tables[t] ?? { visible: 0, rows: 0 };
                        const share = c.rows ? c.visible / c.rows : 0;
                        const level =
                          share === 0 ? "none" : share < 0.5 ? "some" : share < 1 ? "most" : "all";
                        return (
                          <td key={t} className={`num heat__cell heat__cell--${level}`}>
                            {c.visible}/{c.rows}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table ? (
              <Panel title={`Policy mutants on ${table.replaceAll("_", " ")}`}>
                <ul className="mutants">
                  {p.mutants
                    .filter((m) => m.table === table)
                    .map((m) => (
                      <li key={m.id} className="mutants__item">
                        <Badge
                          tone={
                            m.verdict === "caught" ? "ok" : m.verdict === "equivalent" ? "neutral" : "danger"
                          }
                        >
                          {m.verdict}
                        </Badge>
                        <code>{m.id}</code> {m.description}
                        <span className="cell-sub">{m.reason ?? m.evidence}</span>
                      </li>
                    ))}
                </ul>
              </Panel>
            ) : (
              <p className="note">Choose a table heading to see how its rules were tested.</p>
            )}
          </div>
        )}
      </QueryView>
    </Page>
  );
}
