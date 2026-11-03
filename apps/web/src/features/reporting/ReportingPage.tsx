import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/lib/api";
import { formatEur } from "../../shared/lib/format";
import { Badge, Page, QueryView } from "../../shared/ui";

interface Row {
  grant_id: string;
  code: string;
  title: string;
  funder: string;
  period: string;
  status: "open" | "closed";
  direct_eur: string | null;
  indirect_eur: string | null;
  funded_eur: string | null;
  contributors: number | null;
  withheld: boolean;
}

interface Reporting {
  min_group_size: number;
  rows: Row[];
}

export function ReportingPage() {
  const report = useQuery({
    queryKey: ["reporting"],
    queryFn: () => api<Reporting>("/api/grants/reporting"),
  });
  return (
    <Page
      title="Grant totals"
      lead="Monthly personnel costs and funded amounts per grant, as of the last nightly refresh or the month's close."
    >
      <QueryView
        query={report}
        loading="Loading grant totals"
        isEmpty={(r) => r.rows.length === 0}
        empty={{
          title: "No months reported yet",
          body: "Totals appear after the first nightly refresh of a grant month.",
        }}
      >
        {(r) => (
          <>
            <p className="note">
              A total over fewer than {r.min_group_size} people is the pay of those people, so it is shown to
              Finance only.
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Grant totals by month</caption>
                <thead>
                  <tr>
                    <th scope="col">Grant</th>
                    <th scope="col">Month</th>
                    <th scope="col">State</th>
                    <th scope="col" className="num">
                      People
                    </th>
                    <th scope="col" className="num">
                      Direct
                    </th>
                    <th scope="col" className="num">
                      Indirect
                    </th>
                    <th scope="col" className="num">
                      Funded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={`${x.grant_id}/${x.period}`}>
                      <td>
                        {x.code}
                        <span className="cell-sub">{x.funder}</span>
                      </td>
                      <td>{x.period}</td>
                      <td>
                        <Badge tone={x.status === "closed" ? "ok" : "neutral"}>{x.status}</Badge>
                      </td>
                      {x.withheld ? (
                        <td colSpan={4} className="withheld">
                          Not shown: fewer than {r.min_group_size} people, or not computed yet
                        </td>
                      ) : (
                        <>
                          <td className="num">{x.contributors}</td>
                          <td className="num">{formatEur(x.direct_eur)}</td>
                          <td className="num">{formatEur(x.indirect_eur)}</td>
                          <td className="num strong">{formatEur(x.funded_eur)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryView>
    </Page>
  );
}
