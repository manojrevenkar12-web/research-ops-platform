import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/lib/api";
import { Badge, Page, QueryView } from "../../shared/ui";

interface Result {
  app: string;
  title: string;
  owner: { team: string; contact: string };
  pass: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  generated_at: string;
}

export function HandoverPage() {
  const summary = useQuery({
    queryKey: ["handover"],
    queryFn: () => api<Record<string, Result>>("/api/reports/handover"),
  });
  return (
    <Page
      title="Handover status"
      lead="An app goes to its long-term owner only when the gate passes: owner, runbook, alerts, tests for every route, proven access and reversible migrations."
    >
      <QueryView
        query={summary}
        loading="Loading the handover gate"
        isEmpty={(s) => Object.keys(s).length === 0}
        empty={{ title: "No apps checked yet", body: "Run pnpm handover to check every app." }}
      >
        {(s) => (
          <div className="handover">
            {Object.values(s).map((r) => (
              <section key={r.app} className="handover__app" aria-labelledby={`h-${r.app}`}>
                <header className="handover__head">
                  <h2 id={`h-${r.app}`} className="panel__title">
                    {r.title}
                  </h2>
                  <Badge tone={r.pass ? "ok" : "danger"}>{r.pass ? "ready for handover" : "not ready"}</Badge>
                </header>
                <p className="handover__owner">
                  Goes to {r.owner.team} ({r.owner.contact})
                </p>
                <ul className="checks">
                  {r.checks.map((c) => (
                    <li key={c.name} className={`checks__item${c.pass ? "" : " is-failing"}`}>
                      <span className="checks__mark" aria-hidden="true">
                        {c.pass ? "✓" : "✕"}
                      </span>
                      <span>
                        <span className="sr-only">{c.pass ? "Passed: " : "Failed: "}</span>
                        {c.name}
                        <span className="cell-sub">{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryView>
    </Page>
  );
}
