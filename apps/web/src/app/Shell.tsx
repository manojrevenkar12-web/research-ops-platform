import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";
import { NavLink } from "react-router";
import { authMode, personas } from "../shared/lib/auth";
import { ErrorState, Skeleton } from "../shared/ui";
import { useSession } from "./session";

interface NavItem {
  to: string;
  label: string;
  roles?: string[];
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Shot log",
    items: [
      { to: "/shotlog", label: "Campaigns and shots" },
      { to: "/targets", label: "Target inventory" },
    ],
  },
  {
    title: "Grants",
    items: [
      { to: "/time", label: "My hours" },
      { to: "/approvals", label: "Approvals" },
      { to: "/costs", label: "Personnel costs", roles: ["Finance"] },
      { to: "/reporting", label: "Grant totals", roles: ["Finance", "Executive"] },
    ],
  },
  {
    title: "Platform",
    items: [
      { to: "/access", label: "Who can see what" },
      { to: "/handover", label: "Handover status" },
    ],
  },
];

function PersonaPicker() {
  const selectId = useId();
  const { persona, setPersona } = useSession();
  const list = useQuery({ queryKey: ["personas"], queryFn: personas, enabled: authMode === "dev" });
  if (authMode !== "dev") return null;
  return (
    <div className="persona">
      <label className="persona__label" htmlFor={selectId}>
        Signed in as
      </label>
      {list.isPending ? (
        <Skeleton rows={1} label="Loading people" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <select
          id={selectId}
          className="persona__select"
          value={persona ?? ""}
          onChange={(e) => setPersona(e.target.value || null)}
        >
          <option value="">Choose a person…</option>
          {list.data.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}, {p.team} ({p.entity})
            </option>
          ))}
        </select>
      )}
      <p className="persona__hint">Development sign-in. In Azure, people sign in with Microsoft Entra ID.</p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const mainId = useId();
  const { me, has } = useSession();
  return (
    <div className="shell">
      <a className="skip" href={`#${mainId}`}>
        Skip to content
      </a>
      <aside className="rail" aria-label="Apps">
        <div className="rail__brand">
          <span className="rail__mark" aria-hidden="true" />
          <span>Research operations</span>
        </div>
        <nav>
          {GROUPS.map((g) => (
            <div key={g.title} className="rail__group">
              <p className="rail__group-title">{g.title}</p>
              <ul>
                {g.items
                  .filter((i) => !i.roles || i.roles.some(has))
                  .map((i) => (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        className={({ isActive }) => `rail__link${isActive ? " is-active" : ""}`}
                      >
                        {i.label}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="rail__foot">
          <PersonaPicker />
          {me ? (
            <p className="rail__me">
              {me.roles.filter((r) => r !== "Staff").join(", ") || "Staff"} in {me.entity}
            </p>
          ) : null}
        </div>
      </aside>
      <main id={mainId} className="main">
        {children}
      </main>
    </div>
  );
}
