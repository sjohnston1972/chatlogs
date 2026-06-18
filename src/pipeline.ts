import type { Env } from "./types";
import { getRecentRows, parseTranscript } from "./db";
import { getAnalysesFor, getGeoFor, upsertAnalysis } from "./dashdb";
import { analyzeConversation, type AnalysisResult } from "./ai";
import { lookupGeo } from "./geo";

const ANALYSIS_MODEL_DEFAULT = "claude-haiku-4-5";

export interface AnalyzedItem {
  site: string;
  ip: string;
  updated_at: string;
  result: AnalysisResult;
}

/**
 * Incremental analysis: scan the most-recent chat_logs rows, analyze any that
 * are new or whose transcript changed since last analysis, up to `maxToProcess`
 * per run. Also enriches geo for newly-seen IPs. Returns the items analyzed
 * this run (for downstream alerting).
 */
export async function analyzePending(
  env: Env,
  opts: { scanLimit?: number; maxToProcess?: number } = {},
): Promise<AnalyzedItem[]> {
  const scanLimit = opts.scanLimit ?? 150;
  const maxToProcess = opts.maxToProcess ?? 15;
  const model = env.ANALYSIS_MODEL || ANALYSIS_MODEL_DEFAULT;

  const rows = await getRecentRows(env.DB, scanLimit);
  if (rows.length === 0) return [];

  const keys = rows.map((r) => ({ site: r.site, ip: r.ip }));
  const existing = await getAnalysesFor(env.DASH_DB, keys);
  const geo = await getGeoFor(env.DASH_DB, rows.map((r) => r.ip));

  const stale = rows.filter((r) => {
    const a = existing.get(`${r.site}|${r.ip}`);
    return !a || a.source_updated_at !== r.updated_at;
  });

  const analyzed: AnalyzedItem[] = [];
  for (const row of stale.slice(0, maxToProcess)) {
    const t = parseTranscript(row.transcript);
    try {
      const result = await analyzeConversation(env, row.site, t.messages, Boolean(t.cta));
      if (!result) continue;
      await upsertAnalysis(env.DASH_DB, row.site, row.ip, row.updated_at, model, result);
      analyzed.push({ site: row.site, ip: row.ip, updated_at: row.updated_at, result });
    } catch (e) {
      console.error("analyze_error", row.site, row.ip, String(e));
    }
    // Enrich geo for IPs we haven't located yet (best-effort, off request path).
    if (!geo.has(row.ip)) {
      await lookupGeo(env.DASH_DB, row.ip);
    }
  }
  return analyzed;
}

/**
 * Ensure a single conversation is analyzed (lazy, on-view). Returns true if it
 * analyzed (or re-analyzed) this call. No-op if the cache is already current.
 */
export async function analyzeOne(env: Env, site: string, ip: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT site, ip, updated_at, transcript FROM chat_logs WHERE site = ? AND ip = ?`,
  )
    .bind(site, ip)
    .first<{ site: string; ip: string; updated_at: string; transcript: string }>();
  if (!row) return false;

  const existing = await getAnalysesFor(env.DASH_DB, [{ site, ip }]);
  const a = existing.get(`${site}|${ip}`);
  if (a && a.source_updated_at === row.updated_at) return false;

  const t = parseTranscript(row.transcript);
  const model = env.ANALYSIS_MODEL || ANALYSIS_MODEL_DEFAULT;
  const result = await analyzeConversation(env, site, t.messages, Boolean(t.cta));
  if (!result) return false;
  await upsertAnalysis(env.DASH_DB, site, ip, row.updated_at, model, result);
  return true;
}
