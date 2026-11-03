import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeError } from "../../shared/lib/api";
import { formatEur, formatNumber, previousMonth } from "../../shared/lib/format";
import { Button, Field, Notice, Page, Panel, QueryView } from "../../shared/ui";

interface Grant {
  id: string;
  code: string;
  title: string;
  funder: string;
  method: "eu_daily" | "de_hourly";
}

interface Line {
  person_id: string;
  person_name: string;
  approved_hours: string;
  eligible_hours: string;
  late_hours: string;
  over_cap_hours: string;
  other_entity_hours: string;
  rate_eur: string;
  rate_unit: "hour" | "day";
  direct_eur: string;
}

interface Cost {
  lines: Line[];
  direct_eur: string;
  indirect_eur: string;
  funded_eur: string;
  ineligible_hours: string;
  contributors: number;
}

const METHOD = {
  eu_daily: "EU daily rate (annual cost / 215)",
  de_hourly: "German cost basis (annual cost / hours)",
};

export function CostsPage() {
  const grants = useQuery({ queryKey: ["grants"], queryFn: () => api<Grant[]>("/api/grants") });
  const [grantId, setGrantId] = useState<string>("");
  const [period, setPeriod] = useState(previousMonth());
  const chosen = grantId || grants.data?.[0]?.id || "";
  const cost = useQuery({
    queryKey: ["cost", chosen, period],
    queryFn: () => api<Cost>(`/api/grants/${chosen}/cost?period=${period}`),
    enabled: !!chosen && /^\d{4}-\d{2}$/.test(period),
  });
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const close = useMutation({
    mutationFn: () =>
      api<{ funded_eur: string }>(`/api/grants/${chosen}/periods/${period}/close`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (r) => {
      setNotice(`Closed ${period}. Funded amount ${formatEur(r.funded_eur)} is frozen.`);
      qc.invalidateQueries({ queryKey: ["cost"] });
      qc.invalidateQueries({ queryKey: ["reporting"] });
    },
  });
  const grant = grants.data?.find((g) => g.id === chosen);
  return (
    <Page
      title="Personnel costs"
      lead="What a grant may claim for a month: approved, eligible hours at each person's rate, then overheads and the funding rate."
    >
      <QueryView
        query={grants}
        loading="Loading grants"
        empty={{ title: "No grants", body: "Grants appear here once Finance registers them." }}
      >
        {(list) => (
          <div className="stack">
            <div className="form__row">
              <Field label="Grant">
                <select className="input" value={chosen} onChange={(e) => setGrantId(e.target.value)}>
                  {list.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code}: {g.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Month">
                <input
                  className="input"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </Field>
              {grant ? <p className="method">{METHOD[grant.method]}</p> : null}
            </div>
            <QueryView
              query={cost}
              loading="Computing costs"
              isEmpty={(c) => c.lines.length === 0}
              empty={{
                title: "No approved hours this month",
                body: "Costs appear once leads approve hours booked to this grant.",
              }}
            >
              {(c) => (
                <>
                  <dl className="totals">
                    <div>
                      <dt>Direct personnel cost</dt>
                      <dd>{formatEur(c.direct_eur)}</dd>
                    </div>
                    <div>
                      <dt>Indirect cost</dt>
                      <dd>{formatEur(c.indirect_eur)}</dd>
                    </div>
                    <div className="totals__key">
                      <dt>Funded amount</dt>
                      <dd>{formatEur(c.funded_eur)}</dd>
                    </div>
                    <div>
                      <dt>Hours not charged</dt>
                      <dd>{formatNumber(c.ineligible_hours)}</dd>
                    </div>
                  </dl>
                  <div className="table-wrap">
                    <table className="table">
                      <caption className="sr-only">Personnel cost per person</caption>
                      <thead>
                        <tr>
                          <th scope="col">Person</th>
                          <th scope="col" className="num">
                            Approved h
                          </th>
                          <th scope="col" className="num">
                            Eligible h
                          </th>
                          <th scope="col" className="num">
                            Late h
                          </th>
                          <th scope="col" className="num">
                            Over cap h
                          </th>
                          <th scope="col" className="num">
                            Other entity h
                          </th>
                          <th scope="col" className="num">
                            Rate
                          </th>
                          <th scope="col" className="num">
                            Direct cost
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.lines.map((l) => (
                          <tr key={l.person_id}>
                            <td>{l.person_name}</td>
                            <td className="num">{formatNumber(l.approved_hours)}</td>
                            <td className="num">{formatNumber(l.eligible_hours)}</td>
                            <td className="num">{formatNumber(l.late_hours)}</td>
                            <td className="num">{formatNumber(l.over_cap_hours)}</td>
                            <td className="num">{formatNumber(l.other_entity_hours)}</td>
                            <td className="num">
                              {Number(l.rate_eur) ? `${formatEur(l.rate_eur)} / ${l.rate_unit}` : ""}
                            </td>
                            <td className="num">{formatEur(l.direct_eur)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Panel title="Close the month">
                    <p className="panel__text">
                      Closing freezes this month's figures and every entry in it. Corrections found later land
                      in an open month.
                    </p>
                    <div className="form__actions">
                      <Button variant="danger" onClick={() => close.mutate()} busy={close.isPending}>
                        Close {period} for {grant?.code}
                      </Button>
                      <Notice message={notice} />
                      <Notice message={close.isError ? describeError(close.error) : null} tone="danger" />
                    </div>
                  </Panel>
                </>
              )}
            </QueryView>
          </div>
        )}
      </QueryView>
    </Page>
  );
}
