import type { ChatLogRow, Transcript, TranscriptMessage } from "./types";

/**
 * Read-only query layer over the shared chat-logs D1 database.
 *
 * Every statement is a SELECT. User input is ALWAYS passed via .bind() — never
 * interpolated into SQL. The only dynamic SQL fragments are sort column/direction,
 * which are validated against fixed whitelists below.
 */

const SORT_COLUMNS: Record<string, string> = {
  updated_at: "updated_at",
  created_at: "created_at",
  request_count: "request_count",
};

function safeSort(sort: string | null, dir: string | null): { col: string; dir: "ASC" | "DESC" } {
  const col = (sort && SORT_COLUMNS[sort]) || "updated_at";
  const direction = dir && dir.toLowerCase() === "asc" ? "ASC" : "DESC";
  return { col, dir: direction };
}

function parseTranscript(raw: string): Transcript {
  try {
    const t = JSON.parse(raw) as Partial<Transcript>;
    return {
      messages: Array.isArray(t.messages) ? (t.messages as TranscriptMessage[]) : [],
      cta: Boolean(t.cta),
    };
  } catch {
    return { messages: [], cta: false };
  }
}

/** First user message, used as the one-line preview in the conversations list. */
function firstUserMessage(t: Transcript): string {
  const m = t.messages.find((x) => x.role === "user");
  const text = (m?.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? text.slice(0, 160) + "…" : text;
}

// ── Sites summary ────────────────────────────────────────────────────────────

export interface SiteSummary {
  site: string;
  conversations: number;
  requests: number;
  last_activity: string | null;
}

export async function getSites(db: D1Database): Promise<SiteSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT site,
              COUNT(*)              AS conversations,
              SUM(request_count)    AS requests,
              MAX(updated_at)       AS last_activity
       FROM chat_logs
       GROUP BY site
       ORDER BY conversations DESC, site ASC`,
    )
    .all<SiteSummary>();
  return results ?? [];
}

// ── Activity counts ──────────────────────────────────────────────────────────

export interface ActivityStats {
  total_conversations: number;
  total_requests: number;
  conversations_24h: number;
  conversations_7d: number;
  requests_24h: number;
  requests_7d: number;
}

export async function getActivity(db: D1Database, site: string | null): Promise<ActivityStats> {
  const now = Date.now();
  const iso24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const iso7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const whereSite = site ? "WHERE site = ?" : "";
  const binds = site ? [iso24h, iso24h, iso7d, iso7d, site] : [iso24h, iso24h, iso7d, iso7d];

  const row = await db
    .prepare(
      `SELECT
         COUNT(*)                                                        AS total_conversations,
         COALESCE(SUM(request_count), 0)                                 AS total_requests,
         SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END)                AS conversations_24h,
         COALESCE(SUM(CASE WHEN updated_at >= ? THEN request_count END),0) AS requests_24h,
         SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END)                AS conversations_7d,
         COALESCE(SUM(CASE WHEN updated_at >= ? THEN request_count END),0) AS requests_7d
       FROM chat_logs
       ${whereSite}`,
    )
    .bind(...binds)
    .first<{
      total_conversations: number;
      total_requests: number;
      conversations_24h: number | null;
      requests_24h: number;
      conversations_7d: number | null;
      requests_7d: number;
    }>();

  return {
    total_conversations: row?.total_conversations ?? 0,
    total_requests: row?.total_requests ?? 0,
    conversations_24h: row?.conversations_24h ?? 0,
    conversations_7d: row?.conversations_7d ?? 0,
    requests_24h: row?.requests_24h ?? 0,
    requests_7d: row?.requests_7d ?? 0,
  };
}

// ── Conversations list ───────────────────────────────────────────────────────

export interface ConversationListItem {
  site: string;
  ip: string;
  request_count: number;
  created_at: string;
  updated_at: string;
  preview: string;
  cta: boolean;
  message_count: number;
}

export interface ConversationListParams {
  site?: string | null;
  q?: string | null;
  from?: string | null; // ISO date/datetime lower bound on updated_at
  to?: string | null; // ISO date/datetime upper bound on updated_at
  sort?: string | null;
  dir?: string | null;
  limit: number;
  offset: number;
}

export interface ConversationListResult {
  items: ConversationListItem[];
  total: number;
  limit: number;
  offset: number;
}

function buildWhere(params: ConversationListParams): { clause: string; binds: unknown[] } {
  const conds: string[] = [];
  const binds: unknown[] = [];

  if (params.site) {
    conds.push("site = ?");
    binds.push(params.site);
  }
  if (params.q) {
    // Free-text search across the raw transcript JSON (user + assistant text).
    conds.push("transcript LIKE ?");
    binds.push(`%${params.q}%`);
  }
  if (params.from) {
    conds.push("updated_at >= ?");
    binds.push(params.from);
  }
  if (params.to) {
    conds.push("updated_at <= ?");
    binds.push(params.to);
  }

  return { clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "", binds };
}

export async function getConversations(
  db: D1Database,
  params: ConversationListParams,
): Promise<ConversationListResult> {
  const { clause, binds } = buildWhere(params);
  const { col, dir } = safeSort(params.sort ?? null, params.dir ?? null);

  const total =
    (
      await db
        .prepare(`SELECT COUNT(*) AS c FROM chat_logs ${clause}`)
        .bind(...binds)
        .first<{ c: number }>()
    )?.c ?? 0;

  const { results } = await db
    .prepare(
      `SELECT site, ip, request_count, created_at, updated_at, transcript
       FROM chat_logs
       ${clause}
       ORDER BY ${col} ${dir}, site ASC, ip ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, params.limit, params.offset)
    .all<ChatLogRow>();

  const items: ConversationListItem[] = (results ?? []).map((r) => {
    const t = parseTranscript(r.transcript);
    return {
      site: r.site,
      ip: r.ip,
      request_count: r.request_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      preview: firstUserMessage(t),
      cta: Boolean(t.cta),
      message_count: t.messages.length,
    };
  });

  return { items, total, limit: params.limit, offset: params.offset };
}

// ── Conversation detail ──────────────────────────────────────────────────────

export interface ConversationDetail {
  site: string;
  ip: string;
  request_count: number;
  created_at: string;
  updated_at: string;
  cta: boolean;
  messages: TranscriptMessage[];
}

export async function getConversation(
  db: D1Database,
  site: string,
  ip: string,
): Promise<ConversationDetail | null> {
  const row = await db
    .prepare(
      `SELECT site, ip, request_count, created_at, updated_at, transcript
       FROM chat_logs
       WHERE site = ? AND ip = ?`,
    )
    .bind(site, ip)
    .first<ChatLogRow>();

  if (!row) return null;
  const t = parseTranscript(row.transcript);
  return {
    site: row.site,
    ip: row.ip,
    request_count: row.request_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cta: Boolean(t.cta),
    messages: t.messages,
  };
}
