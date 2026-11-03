import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/lib/api";
import { formatDay } from "../../shared/lib/format";
import { Page, QueryView } from "../../shared/ui";

interface Target {
  id: string;
  serial: string;
  batch: string;
  design: string;
  status: "fabricated" | "characterized" | "allocated" | "shot" | "scrapped";
  campaign_code: string | null;
  updated_at: string;
}

// The stages a target goes through, in order; scrapped can happen at any stage before the shot.
const STAGES = [
  { key: "fabricated", title: "Fabricated", body: "Made, not yet measured" },
  { key: "characterized", title: "Characterised", body: "Measured and ready" },
  { key: "allocated", title: "Allocated", body: "Reserved for a campaign" },
  { key: "shot", title: "Shot", body: "Used; cannot be used again" },
  { key: "scrapped", title: "Scrapped", body: "Damaged or out of spec" },
] as const;

export function TargetsPage() {
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api<Target[]>("/api/shotlog/targets") });
  return (
    <Page
      title="Target inventory"
      lead="Every target from fabrication to the shot that uses it up. Each change is logged by the database."
    >
      <QueryView
        query={targets}
        loading="Loading the inventory"
        empty={{
          title: "No targets registered",
          body: "Targets appear here when target fabrication registers a new batch.",
        }}
      >
        {(list) => (
          <ol className="board" aria-label="Targets by stage">
            {STAGES.map((stage) => {
              const items = list.filter((t) => t.status === stage.key);
              return (
                <li key={stage.key} className={`board__col board__col--${stage.key}`}>
                  <h2 className="board__title">
                    {stage.title} <span className="board__count">{items.length}</span>
                  </h2>
                  <p className="board__body">{stage.body}</p>
                  <ul className="board__items">
                    {items.map((t) => (
                      <li key={t.id} className="board__item">
                        <span className="board__serial">{t.serial}</span>
                        <span className="board__design">{t.design}</span>
                        <span className="board__meta">
                          {t.campaign_code ? `${t.campaign_code}, ` : ""}batch {t.batch},{" "}
                          {formatDay(t.updated_at)}
                        </span>
                      </li>
                    ))}
                    {items.length === 0 ? <li className="board__none">None</li> : null}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </QueryView>
    </Page>
  );
}
