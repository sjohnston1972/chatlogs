import type {
  ActivityStats,
  Analytics,
  AskResult,
  BotReport,
  ConversationDetail,
  ConversationListResult,
  SiteSummary,
  TriageState,
} from "./types";

async function req<T>(
  path: string,
  opts: { params?: Record<string, string | number | boolean | undefined>; method?: string; body?: unknown } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: opts.body
      ? { Accept: "application/json", "Content-Type": "application/json" }
      : { Accept: "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    throw new Error("Session expired — reload to re-authenticate with Cloudflare Access.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string; detail?: string };
      detail = b.detail || b.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export interface ConversationFilters {
  site?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
  intent?: string;
  sentiment?: string;
  lead?: boolean;
  failed?: boolean;
  starred?: boolean;
  archived?: boolean;
  read?: boolean;
  leadStatus?: string;
}

export const api = {
  sites: () => req<{ sites: SiteSummary[] }>("/api/sites"),
  activity: (site?: string) => req<ActivityStats>("/api/activity", { params: { site } }),
  conversations: (params: ConversationFilters) =>
    req<ConversationListResult & { keysCapped: boolean }>("/api/conversations", {
      params: params as Record<string, string | number | boolean | undefined>,
    }),
  conversation: (site: string, ip: string) =>
    req<ConversationDetail>("/api/conversation", { params: { site, ip } }),
  analytics: (site: string | undefined, days: number) =>
    req<Analytics>("/api/analytics", { params: { site, days } }),
  ask: (question: string) =>
    req<AskResult>("/api/ask", { method: "POST", body: { question } }),
  improveGet: (site: string) => req<BotReport>("/api/improve", { params: { site } }),
  improveRun: (site: string) => req<BotReport>("/api/improve", { method: "POST", params: { site } }),
  triage: (site: string, ip: string, patch: Partial<TriageState>) =>
    req<{ triage: TriageState }>("/api/triage", { method: "POST", body: { site, ip, ...patch } }),
  exportUrl: (params: ConversationFilters & { format: "csv" | "json" }) => {
    const url = new URL("/api/export", window.location.origin);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  },
};
