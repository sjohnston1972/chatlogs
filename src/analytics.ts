/**
 * Analytics queries.
 *  - chat_logs (read-only): volume time-series, CTA funnel, hour×weekday heatmap,
 *    per-site scorecards. CTA and message counts are read from the transcript
 *    JSON via SQLite json_extract / json_array_length.
 *  - DASH_DB: intent & sentiment breakdowns, lead stats, geo distribution.
 */

function siteClause(site: string | null): { clause: string; binds: unknown[] } {
  return site ? { clause: "WHERE site = ?", binds: [site] } : { clause: "", binds: [] };
}

// ── chat_logs analytics ──────────────────────────────────────────────────────

export interface DailyPoint {
  day: string;
  conversations: number;
  requests: number;
}

export async function timeSeries(
  db: D1Database,
  days: number,
  site: string | null,
): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const conds = ["updated_at >= ?"];
  const binds: unknown[] = [since];
  if (site) {
    conds.push("site = ?");
    binds.push(site);
  }
  const { results } = await db
    .prepare(
      `SELECT substr(updated_at, 1, 10) AS day,
              COUNT(*) AS conversations,
              COALESCE(SUM(request_count), 0) AS requests
       FROM chat_logs
       WHERE ${conds.join(" AND ")}
       GROUP BY day
       ORDER BY day ASC`,
    )
    .bind(...binds)
    .all<DailyPoint>();
  return results ?? [];
}

export interface CtaFunnel {
  conversations: number;
  cta: number;
  rate: number;
}

export async function ctaFunnel(db: D1Database, site: string | null): Promise<CtaFunnel> {
  const { clause, binds } = siteClause(site);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS conversations,
              COALESCE(SUM(CASE WHEN json_extract(transcript, '$.cta') = 1 THEN 1 ELSE 0 END), 0) AS cta
       FROM chat_logs ${clause}`,
    )
    .bind(...binds)
    .first<{ conversations: number; cta: number }>();
  const conversations = row?.conversations ?? 0;
  const cta = row?.cta ?? 0;
  return { conversations, cta, rate: conversations ? cta / conversations : 0 };
}

export interface HeatCell {
  dow: number; // 0 = Sunday
  hour: number; // 0-23
  count: number;
}

export async function heatmap(db: D1Database, site: string | null): Promise<HeatCell[]> {
  const { clause, binds } = siteClause(site);
  const { results } = await db
    .prepare(
      `SELECT CAST(strftime('%w', updated_at) AS INTEGER) AS dow,
              CAST(strftime('%H', updated_at) AS INTEGER) AS hour,
              COUNT(*) AS count
       FROM chat_logs ${clause}
       GROUP BY dow, hour`,
    )
    .bind(...binds)
    .all<HeatCell>();
  return results ?? [];
}

export interface SiteScore {
  site: string;
  conversations: number;
  requests: number;
  avg_messages: number;
  avg_requests: number;
  cta: number;
  cta_rate: number;
}

export async function siteScorecards(db: D1Database): Promise<SiteScore[]> {
  const { results } = await db
    .prepare(
      `SELECT site,
              COUNT(*) AS conversations,
              COALESCE(SUM(request_count), 0) AS requests,
              COALESCE(AVG(json_array_length(transcript, '$.messages')), 0) AS avg_messages,
              COALESCE(AVG(request_count), 0) AS avg_requests,
              COALESCE(SUM(CASE WHEN json_extract(transcript, '$.cta') = 1 THEN 1 ELSE 0 END), 0) AS cta
       FROM chat_logs
       GROUP BY site
       ORDER BY conversations DESC`,
    )
    .all<Omit<SiteScore, "cta_rate">>();
  return (results ?? []).map((r) => ({
    ...r,
    avg_messages: Math.round((r.avg_messages || 0) * 10) / 10,
    avg_requests: Math.round((r.avg_requests || 0) * 10) / 10,
    cta_rate: r.conversations ? r.cta / r.conversations : 0,
  }));
}

// ── DASH_DB analytics ────────────────────────────────────────────────────────

export interface Breakdown {
  key: string;
  count: number;
}

export async function intentBreakdown(
  db: D1Database,
  site: string | null,
): Promise<Breakdown[]> {
  const { clause, binds } = siteClause(site);
  const { results } = await db
    .prepare(
      `SELECT intent AS key, COUNT(*) AS count FROM analysis ${clause} GROUP BY intent ORDER BY count DESC`,
    )
    .bind(...binds)
    .all<Breakdown>();
  return results ?? [];
}

export async function sentimentBreakdown(
  db: D1Database,
  site: string | null,
): Promise<Breakdown[]> {
  const { clause, binds } = siteClause(site);
  const { results } = await db
    .prepare(
      `SELECT sentiment AS key, COUNT(*) AS count FROM analysis ${clause} GROUP BY sentiment ORDER BY count DESC`,
    )
    .bind(...binds)
    .all<Breakdown>();
  return results ?? [];
}

export interface LeadStats {
  analyzed: number;
  leads: number;
  bot_failures: number;
  avg_lead_score: number;
}

export async function leadStats(db: D1Database, site: string | null): Promise<LeadStats> {
  const { clause, binds } = siteClause(site);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS analyzed,
              COALESCE(SUM(is_lead), 0) AS leads,
              COALESCE(SUM(bot_failed), 0) AS bot_failures,
              COALESCE(AVG(lead_score), 0) AS avg_lead_score
       FROM analysis ${clause}`,
    )
    .bind(...binds)
    .first<LeadStats>();
  return {
    analyzed: row?.analyzed ?? 0,
    leads: row?.leads ?? 0,
    bot_failures: row?.bot_failures ?? 0,
    avg_lead_score: Math.round(row?.avg_lead_score ?? 0),
  };
}

export async function geoBreakdown(db: D1Database): Promise<Breakdown[]> {
  const { results } = await db
    .prepare(
      `SELECT COALESCE(country, 'Unknown') AS key, COUNT(*) AS count
       FROM geo GROUP BY country ORDER BY count DESC LIMIT 12`,
    )
    .all<Breakdown>();
  return results ?? [];
}
