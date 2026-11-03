import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, makeQueryClient } from "./App";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });

const PERSONAS = [
  {
    key: "ana",
    name: "Ana Weber",
    team: "Experimental Physics",
    entity: "DE",
    roles: ["Staff", "Scientist", "RestrictedTechnical"],
  },
  { key: "dan", name: "Dan Fischer", team: "Finance", entity: "DE", roles: ["Staff", "Finance"] },
];
const ME = (roles: string[]) => ({
  id: "p1",
  display_name: "Ana Weber",
  email: "ana@example.com",
  entity: "DE",
  team: "Lab",
  roles,
  apps: [],
});

function mockApi(routes: Record<string, Handler>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      if (!key) return json({ title: `no mock for ${url}` }, 500);
      return routes[key]!(url, init);
    }),
  );
}

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  const client = makeQueryClient();
  // Same retry policy as in the app, without waiting between attempts.
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(<App client={client} />);
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("console", () => {
  it("asks who you are before showing anything", async () => {
    mockApi({ "/dev/personas": () => json(PERSONAS) });
    renderAt("/shotlog");
    expect(await screen.findByText("Who are you?")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Ana Weber/ })).toBeInTheDocument();
  });

  it("shows a skeleton while loading, then the campaigns", async () => {
    localStorage.setItem("rop.persona", "ana");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockApi({
      "/dev/personas": () => json(PERSONAS),
      "/dev/token": () => json({ token: "t", persona: "ana" }),
      "/api/me": () => json(ME(["Staff", "Scientist"])),
      "/api/shotlog/campaigns/c1/shots": () => json([]),
      "/api/shotlog/campaigns/c1": () =>
        json({
          id: "c1",
          code: "PHX-1",
          title: "T",
          facility: "Lab",
          entity: "DE",
          classification: "internal",
          lead_name: "Ana",
          starts_on: "2026-10-01",
          ends_on: null,
          shots: 0,
          last_shot_at: null,
          members: [],
        }),
      "/api/shotlog/campaigns": async () => {
        await gate;
        return json([
          {
            id: "c1",
            code: "PHX-1",
            title: "Alignment",
            facility: "Lab",
            entity: "DE",
            classification: "internal",
            lead_name: "Ana Weber",
            starts_on: "2026-10-01",
            ends_on: null,
            shots: 0,
            last_shot_at: null,
          },
        ]);
      },
    });
    renderAt("/shotlog");
    expect(await screen.findByRole("status", { name: "Loading campaigns" })).toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: /PHX-1/ })).toBeInTheDocument();
    expect(await screen.findByText("No shots yet")).toBeInTheDocument();
  });

  it("explains a failure and retries on request", async () => {
    localStorage.setItem("rop.persona", "ana");
    let calls = 0;
    mockApi({
      "/dev/personas": () => json(PERSONAS),
      "/dev/token": () => json({ token: "t", persona: "ana" }),
      "/api/me": () => json(ME(["Staff", "Scientist"])),
      "/api/shotlog/targets": () => {
        calls += 1;
        // The first three attempts fail: the app retries a server error twice before showing it.
        return calls <= 3 ? json({ title: "Something went wrong on our side.", status: 500 }, 500) : json([]);
      },
    });
    renderAt("/targets");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
    expect(calls).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No targets registered")).toBeInTheDocument();
  });

  it("shows an empty state that says what to do next", async () => {
    localStorage.setItem("rop.persona", "ana");
    mockApi({
      "/dev/personas": () => json(PERSONAS),
      "/dev/token": () => json({ token: "t", persona: "ana" }),
      "/api/me": () => json(ME(["Staff", "Scientist"])),
      "/api/grants/approvals": () => json([]),
    });
    renderAt("/approvals");
    expect(await screen.findByText("Nothing to decide")).toBeInTheDocument();
    expect(screen.getByText(/When someone submits hours to a grant you lead/)).toBeInTheDocument();
  });

  it("offers Finance pages only to people with the role", async () => {
    localStorage.setItem("rop.persona", "ana");
    mockApi({
      "/dev/personas": () => json(PERSONAS),
      "/dev/token": () => json({ token: "t", persona: "ana" }),
      "/api/me": () => json(ME(["Staff", "Scientist"])),
      "/api/shotlog/campaigns": () => json([]),
    });
    renderAt("/shotlog");
    await screen.findByText("No campaigns to show");
    expect(screen.queryByRole("link", { name: "Personnel costs" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My hours" })).toBeInTheDocument();
  });

  it("does not retry a refusal, and says plainly that the roles do not allow it", async () => {
    localStorage.setItem("rop.persona", "ana");
    const costs = vi.fn(() => json({ title: "This needs one of the roles: Finance.", status: 403 }, 403));
    mockApi({
      "/dev/personas": () => json(PERSONAS),
      "/dev/token": () => json({ token: "t", persona: "ana" }),
      "/api/me": () => json(ME(["Staff", "Finance"])),
      "/api/grants/g1/cost": costs,
      "/api/grants": () => json([{ id: "g1", code: "EU-1", title: "T", funder: "EC", method: "eu_daily" }]),
    });
    renderAt("/costs");
    expect(await screen.findByText("Your roles do not allow this.")).toBeInTheDocument();
    await waitFor(() => expect(costs).toHaveBeenCalledTimes(1));
  });
});
