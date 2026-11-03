import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useSession } from "../../app/session";
import { describeError } from "../../shared/lib/api";
import { formatDay, formatNumber, formatTime } from "../../shared/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Notice,
  Page,
  Panel,
  QueryView,
  Restricted,
} from "../../shared/ui";
import {
  type Campaign,
  type Outcome,
  useCampaign,
  useCampaigns,
  useLogShot,
  useSearch,
  useShots,
} from "./api";
import { ShotStrip } from "./ShotStrip";

const OUTCOMES: Outcome[] = ["nominal", "partial", "misfire", "aborted"];

function CampaignList({ campaigns, current }: { campaigns: Campaign[]; current?: string }) {
  return (
    <ul className="list" aria-label="Campaigns">
      {campaigns.map((c) => (
        <li key={c.id}>
          <Link
            to={`/shotlog/${c.id}`}
            className={`list__item${c.id === current ? " is-current" : ""}${c.classification === "restricted" ? " is-restricted" : ""}`}
            aria-current={c.id === current ? "page" : undefined}
          >
            <span className="list__primary">
              {c.code} <Restricted classification={c.classification} />
            </span>
            <span className="list__secondary">{c.title}</span>
            <span className="list__meta">
              {c.shots} {c.shots === 1 ? "shot" : "shots"}, led by {c.lead_name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LogShot({ campaignId }: { campaignId: string }) {
  const log = useLogShot(campaignId);
  const [notice, setNotice] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    const form = e.currentTarget;
    log.mutate(
      {
        fired_at: new Date(String(f.get("fired_at"))).toISOString(),
        outcome: f.get("outcome") as Outcome,
        energy_j: num("energy_j"),
        pulse_ns: num("pulse_ns"),
        notes: String(f.get("notes") ?? ""),
      },
      {
        onSuccess: (r) => {
          setNotice(`Logged shot ${r.shot_no}.`);
          form.reset();
        },
      },
    );
  };
  return (
    <form className="form" onSubmit={submit} aria-label="Log a shot">
      <div className="form__row">
        <Field label="Fired at (your time)">
          <input name="fired_at" type="datetime-local" required className="input" />
        </Field>
        <Field label="Outcome">
          <select name="outcome" className="input" defaultValue="nominal">
            {OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Energy (J)">
          <input name="energy_j" type="number" step="0.01" min="0" className="input" />
        </Field>
        <Field label="Pulse (ns)">
          <input name="pulse_ns" type="number" step="0.001" min="0" className="input" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea name="notes" rows={2} className="input" />
      </Field>
      <div className="form__actions">
        <Button type="submit" busy={log.isPending}>
          Log shot
        </Button>
        <Notice message={notice} />
        <Notice message={log.isError ? describeError(log.error) : null} tone="danger" />
      </div>
    </form>
  );
}

function CampaignView({ id }: { id: string }) {
  const campaign = useCampaign(id);
  const shots = useShots(id);
  const { has, me } = useSession();
  return (
    <QueryView query={campaign} loading="Loading the campaign">
      {(c) => {
        const canLog =
          has("Scientist") &&
          c.members.some((m) => m.person_id === me?.id && (m.role === "lead" || m.role === "operator"));
        return (
          <div className="stack">
            <header className={`campaign${c.classification === "restricted" ? " is-restricted" : ""}`}>
              <h2 className="campaign__title">
                {c.code} <Restricted classification={c.classification} />
              </h2>
              <p className="campaign__sub">
                {c.title}. {c.facility}, from {formatDay(c.starts_on)}
                {c.ends_on ? ` to ${formatDay(c.ends_on)}` : ""}.
              </p>
              <p className="campaign__members">
                {c.members.map((m) => `${m.display_name} (${m.role})`).join(", ")}
              </p>
            </header>
            <QueryView
              query={shots}
              loading="Loading shots"
              empty={{
                title: "No shots yet",
                body: canLog
                  ? "Log the first shot of this campaign below."
                  : "Shots appear here once an operator logs them.",
              }}
            >
              {(list) => (
                <>
                  <ShotStrip shots={list} />
                  <div className="table-wrap">
                    <table className="table">
                      <caption className="sr-only">Shots of {c.code}, latest first</caption>
                      <thead>
                        <tr>
                          <th scope="col">Shot</th>
                          <th scope="col">Fired</th>
                          <th scope="col">Outcome</th>
                          <th scope="col" className="num">
                            Energy (J)
                          </th>
                          <th scope="col">Target</th>
                          <th scope="col">Notes</th>
                          <th scope="col">Logged by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((s) => (
                          <tr key={s.id}>
                            <td className="num">{s.shot_no}</td>
                            <td>{formatTime(s.fired_at)}</td>
                            <td>
                              <span className={`outcome outcome--${s.outcome}`}>{s.outcome}</span>
                              {s.corrections > 0 ? <Badge tone="warn">corrected</Badge> : null}
                            </td>
                            <td className="num">{formatNumber(s.energy_j)}</td>
                            <td>{s.target_serial ?? ""}</td>
                            <td className="notes">{s.notes}</td>
                            <td>{s.logged_by_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </QueryView>
            {canLog ? (
              <Panel title="Log the next shot">
                <LogShot campaignId={id} />
              </Panel>
            ) : null}
          </div>
        );
      }}
    </QueryView>
  );
}

function SearchResults({ q }: { q: string }) {
  const hits = useSearch(q);
  return (
    <Panel title={`Shots matching “${q}”`}>
      <QueryView
        query={hits}
        loading="Searching"
        empty={{
          title: "No matching shots",
          body: "Search covers the notes and outcomes of shots you may read. Try another word.",
        }}
      >
        {(list) => (
          <ul className="hits">
            {list.map((h) => (
              <li key={h.id} className="hits__item">
                <Link to={`/shotlog/${h.campaign_id}`}>
                  {h.campaign_code} shot {h.shot_no}
                </Link>{" "}
                <span className="hits__when">{formatTime(h.fired_at)}</span>
                {/* ts_headline marks matches with <b>; every other part is rendered as text, never as markup */}
                <p className="hits__snippet">
                  {h.snippet.split(/(<b>.*?<\/b>)/).map((part, i) =>
                    part.startsWith("<b>") ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fragments of one string
                      <mark key={i}>{part.slice(3, -4)}</mark>
                    ) : (
                      part
                    ),
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

export function ShotLogPage() {
  const searchId = useId();
  const { campaignId } = useParams();
  const campaigns = useCampaigns();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  return (
    <Page
      title="Campaigns and shots"
      lead="Every shot of every campaign you may see. Entries are never changed; a correction is a new entry."
      actions={
        <search>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(q.trim());
            }}
          >
            <label htmlFor={searchId} className="sr-only">
              Search shot notes
            </label>
            <input
              id={searchId}
              className="input"
              placeholder="Search notes, e.g. interlock"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              minLength={2}
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </search>
      }
    >
      <div className="split">
        <div className="split__side">
          <QueryView
            query={campaigns}
            loading="Loading campaigns"
            empty={{
              title: "No campaigns to show",
              body: "You see the campaigns your roles allow. Scientists see the lab's campaigns; clearance adds restricted ones.",
            }}
          >
            {(list) => {
              if (!campaignId && list[0] && !submitted)
                queueMicrotask(() => navigate(`/shotlog/${list[0]!.id}`, { replace: true }));
              return <CampaignList campaigns={list} current={campaignId} />;
            }}
          </QueryView>
        </div>
        <div className="split__main">
          {submitted.length >= 2 ? (
            <div className="stack">
              <SearchResults q={submitted} />
              <Button variant="quiet" onClick={() => setSubmitted("")}>
                Back to the campaign
              </Button>
            </div>
          ) : campaignId ? (
            <CampaignView id={campaignId} />
          ) : campaigns.data?.length === 0 ? null : (
            <EmptyState title="Choose a campaign" body="Pick a campaign on the left to see its shots." />
          )}
        </div>
      </div>
    </Page>
  );
}
