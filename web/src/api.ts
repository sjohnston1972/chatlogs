import type {
  ActivityStats,
  ConversationDetail,
  ConversationListResult,
  SiteSummary,
} from "./types";

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (res.status === 401) {
    throw new Error("Session expired — reload to re-authenticate with Cloudflare Access.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      detail = body.detail || body.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  sites: () => get<{ sites: SiteSummary[] }>("/api/sites"),
  activity: (site?: string) => get<ActivityStats>("/api/activity", { site }),
  conversations: (params: {
    site?: string;
    q?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
    page?: number;
    pageSize?: number;
  }) => get<ConversationListResult>("/api/conversations", params),
  conversation: (site: string, ip: string) =>
    get<ConversationDetail>("/api/conversation", { site, ip }),
};
