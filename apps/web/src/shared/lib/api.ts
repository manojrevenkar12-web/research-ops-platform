// The API client: every call carries the person's token and every failure becomes an ApiError with the
// problem's title, so screens can say what went wrong in plain words.
import { accessToken } from "./auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(detail ? `${title} ${detail}` : title);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  const r = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) {
    const p = (data ?? {}) as { title?: string; detail?: string };
    throw new ApiError(r.status, p.title ?? `Request failed (${r.status}).`, p.detail, data);
  }
  return data as T;
}

/** A short sentence for a failed request, for error states. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "You are not signed in. Pick who you are in the sidebar.";
    if (err.status === 403) return "Your roles do not allow this.";
    return err.detail ? `${err.title} ${firstSentence(err.detail)}` : err.title;
  }
  if (err instanceof TypeError) return "The API cannot be reached. Check that it is running.";
  return err instanceof Error ? err.message : "Something went wrong.";
}

function firstSentence(s: string): string {
  const cleaned = s.replace(/^.*?: /, "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/\.?$/, ".");
}
