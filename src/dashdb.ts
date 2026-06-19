import type { Analysis, Triage } from "./types";
import type { AnalysisResult } from "./ai";

/**
 * Dashboard-owned D1 (DASH_DB) accessors: analysis cache, triage state, geo
 * cache, key/value meta, and the alert log. This database is fully writable by
 * the dashboard; the shared chat_logs DB is never written to.
 */

function nowIso(): string {
  return new Date().toISOString();
}

// ── Analysis cache ───────────────────────────────────────────────────────────

export async function getAnalysis(
  db: D1Database,
  site: string,
  ip: string,
): Promise<Analysis | null> {
  return db
    .prepare(`SELECT * FROM analysis WHERE site = ? AND ip = ?`)
    .bind(site, ip)
    .first<Analysis>();
}

/** Map of "site|ip" -> Analysis for a set of conversations (list view join). */
export async function getAnalysesFor(
  db: D1Database,
  keys: { site: string; ip: string }[],
): Promise<Map<string, Analysis>> {
  const map = new Map<string, Analysis>();
  if (keys.length === 0) return map;
  // D1 has no array binding; build an OR of (site=? AND ip=?) in chunks.
  const chunkSize = 50;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const where = chunk.map(() => "(site = ? AND ip = ?)").join(" OR ");
    const binds = chunk.flatMap((k) => [k.site, k.ip]);
    const { results } = await db
      .prepare(`SELECT * FROM analysis WHERE ${where}`)
      .bind(...binds)
      .all<Analysis>();
    for (const r of results ?? []) map.set(`${r.site}|${r.ip}`, r);
  }
  return map;
}

export async function upsertAnalysis(
  db: D1Database,
  site: string,
  ip: string,
  sourceUpdatedAt: string,
  model: string,
  a: AnalysisResult,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analysis
         (site, ip, source_updated_at, summary, intent, sentiment, lead_score,
          is_lead, bot_failed, topics, model, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site, ip) DO UPDATE SET
         source_updated_at = excluded.source_updated_at,
         summary = excluded.summary,
         intent = excluded.intent,
         sentiment = excluded.sentiment,
         lead_score = excluded.lead_score,
         is_lead = excluded.is_lead,
         bot_failed = excluded.bot_failed,
         topics = excluded.topics,
         model = excluded.model,
         analyzed_at = excluded.analyzed_at`,
    )
    .bind(
      site,
      ip,
      sourceUpdatedAt,
      a.summary,
      a.intent,
      a.sentiment,
      a.lead_score,
      a.is_lead ? 1 : 0,
      a.bot_failed ? 1 : 0,
      JSON.stringify(a.topics),
      model,
      nowIso(),
    )
    .run();
}

// ── Triage ─────────────────────────────────────────────────────────────────

export async function getTriage(
  db: D1Database,
  site: string,
  ip: string,
): Promise<Triage | null> {
  return db
    .prepare(`SELECT * FROM triage WHERE site = ? AND ip = ?`)
    .bind(site, ip)
    .first<Triage>();
}

export async function getTriageFor(
  db: D1Database,
  keys: { site: string; ip: string }[],
): Promise<Map<string, Triage>> {
  const map = new Map<string, Triage>();
  if (keys.length === 0) return map;
  const chunkSize = 50;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const where = chunk.map(() => "(site = ? AND ip = ?)").join(" OR ");
    const binds = chunk.flatMap((k) => [k.site, k.ip]);
    const { results } = await db
      .prepare(`SELECT * FROM triage WHERE ${where}`)
      .bind(...binds)
      .all<Triage>();
    for (const r of results ?? []) map.set(`${r.site}|${r.ip}`, r);
  }
  return map;
}

const TRIAGE_FIELDS = ["is_read", "starred", "archived", "lead_status", "note", "tags"] as const;
type TriageField = (typeof TRIAGE_FIELDS)[number];

/** Patch one or more triage fields for a conversation (upsert). */
export async function patchTriage(
  db: D1Database,
  site: string,
  ip: string,
  patch: Partial<Record<TriageField, unknown>>,
): Promise<Triage> {
  const existing = await getTriage(db, site, ip);
  const merged: Record<string, unknown> = {
    is_read: existing?.is_read ?? 0,
    starred: existing?.starred ?? 0,
    archived: existing?.archived ?? 0,
    lead_status: existing?.lead_status ?? null,
    note: existing?.note ?? null,
    tags: existing?.tags ?? null,
  };
  for (const f of TRIAGE_FIELDS) {
    if (f in patch) {
      if (f === "is_read" || f === "starred" || f === "archived") {
        merged[f] = patch[f] ? 1 : 0;
      } else if (f === "tags") {
        merged[f] = Array.isArray(patch[f]) ? JSON.stringify(patch[f]) : patch[f] ?? null;
      } else {
        merged[f] = patch[f] ?? null;
      }
    }
  }

  await db
    .prepare(
      `INSERT INTO triage (site, ip, is_read, starred, archived, lead_status, note, tags, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site, ip) DO UPDATE SET
         is_read = excluded.is_read,
         starred = excluded.starred,
         archived = excluded.archived,
         lead_status = excluded.lead_status,
         note = excluded.note,
         tags = excluded.tags,
         updated_at = excluded.updated_at`,
    )
    .bind(
      site,
      ip,
      merged.is_read,
      merged.starred,
      merged.archived,
      merged.lead_status,
      merged.note,
      merged.tags,
      nowIso(),
    )
    .run();

  return (await getTriage(db, site, ip))!;
}

// ── Filter key resolution (AI + triage) ─────────────────────────────────────

export interface KeyFilters {
  site?: string | null;
  intent?: string | null;
  sentiment?: string | null;
  lead?: boolean; // is_lead = 1
  failed?: boolean; // bot_failed = 1
  minLeadScore?: number | null;
  read?: boolean | null; // triage.is_read
  starred?: boolean | null;
  archived?: boolean | null;
  leadStatus?: string | null;
}

export function hasKeyFilters(f: KeyFilters): boolean {
  return (
    !!f.intent ||
    !!f.sentiment ||
    f.lead === true ||
    f.failed === true ||
    (f.minLeadScore ?? 0) > 0 ||
    f.read === true ||
    f.read === false ||
    f.starred === true ||
    f.archived === true ||
    !!f.leadStatus
  );
}

const VALID_INTENTS = new Set([
  "pricing",
  "support",
  "booking",
  "lead",
  "complaint",
  "smalltalk",
  "other",
]);
const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative", "frustrated"]);
const VALID_LEAD_STATUS = new Set(["new", "contacted", "closed"]);

/**
 * Resolve AI/triage filters to a capped list of "site|ip" keys. Both analysis
 * and triage live in DASH_DB so they are joined directly. Driven from analysis
 * when any AI filter is present, otherwise from triage.
 */
export async function getFilterKeys(
  db: D1Database,
  f: KeyFilters,
  cap = 1000,
): Promise<string[]> {
  const aiActive =
    !!f.intent || !!f.sentiment || f.lead === true || f.failed === true || (f.minLeadScore ?? 0) > 0;

  const conds: string[] = [];
  const binds: unknown[] = [];

  const driveFromAnalysis = aiActive;
  const aAlias = driveFromAnalysis ? "a" : "t";

  if (f.site) {
    conds.push(`${aAlias}.site = ?`);
    binds.push(f.site);
  }
  if (aiActive) {
    if (f.intent && VALID_INTENTS.has(f.intent)) {
      conds.push("a.intent = ?");
      binds.push(f.intent);
    }
    if (f.sentiment && VALID_SENTIMENTS.has(f.sentiment)) {
      conds.push("a.sentiment = ?");
      binds.push(f.sentiment);
    }
    if (f.lead === true) conds.push("a.is_lead = 1");
    if (f.failed === true) conds.push("a.bot_failed = 1");
    if ((f.minLeadScore ?? 0) > 0) {
      conds.push("a.lead_score >= ?");
      binds.push(Math.round(f.minLeadScore!));
    }
  }
  if (f.read === true) conds.push("t.is_read = 1");
  if (f.read === false) conds.push("COALESCE(t.is_read, 0) = 0");
  if (f.starred === true) conds.push("t.starred = 1");
  if (f.archived === true) conds.push("t.archived = 1");
  if (f.leadStatus && VALID_LEAD_STATUS.has(f.leadStatus)) {
    conds.push("t.lead_status = ?");
    binds.push(f.leadStatus);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const sql = driveFromAnalysis
    ? `SELECT a.site, a.ip FROM analysis a LEFT JOIN triage t ON t.site = a.site AND t.ip = a.ip ${where} LIMIT ?`
    : `SELECT t.site, t.ip FROM triage t ${where} LIMIT ?`;

  const { results } = await db
    .prepare(sql)
    .bind(...binds, cap)
    .all<{ site: string; ip: string }>();
  return (results ?? []).map((r) => `${r.site}|${r.ip}`);
}

// ── Geo cache ────────────────────────────────────────────────────────────────

export interface GeoRow {
  ip: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  asn: string | null;
  org: string | null;
  looked_up_at: string;
}

export async function getGeoFor(db: D1Database, ips: string[]): Promise<Map<string, GeoRow>> {
  const map = new Map<string, GeoRow>();
  const uniq = [...new Set(ips)];
  const chunkSize = 100;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const where = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT * FROM geo WHERE ip IN (${where})`)
      .bind(...chunk)
      .all<GeoRow>();
    for (const r of results ?? []) map.set(r.ip, r);
  }
  return map;
}

export async function upsertGeo(db: D1Database, g: Omit<GeoRow, "looked_up_at">): Promise<void> {
  await db
    .prepare(
      `INSERT INTO geo (ip, country, country_code, region, city, asn, org, looked_up_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         country = excluded.country, country_code = excluded.country_code,
         region = excluded.region, city = excluded.city,
         asn = excluded.asn, org = excluded.org, looked_up_at = excluded.looked_up_at`,
    )
    .bind(g.ip, g.country, g.country_code, g.region, g.city, g.asn, g.org, nowIso())
    .run();
}

// ── Meta KV ──────────────────────────────────────────────────────────────────

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT v FROM meta WHERE k = ?`).bind(key).first<{ v: string }>();
  return row?.v ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
    .bind(key, value)
    .run();
}

// ── Bot-improvement reports ──────────────────────────────────────────────────

export interface BotReportRow {
  site: string;
  generated_at: string;
  window_days: number;
  conversations_analyzed: number;
  failure_rate: number;
  health_score: number;
  report: string; // JSON
  model: string;
}

export async function getBotReport(db: D1Database, site: string): Promise<BotReportRow | null> {
  return db.prepare(`SELECT * FROM bot_reports WHERE site = ?`).bind(site).first<BotReportRow>();
}

export async function upsertBotReport(db: D1Database, r: BotReportRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bot_reports
         (site, generated_at, window_days, conversations_analyzed, failure_rate, health_score, report, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site) DO UPDATE SET
         generated_at = excluded.generated_at,
         window_days = excluded.window_days,
         conversations_analyzed = excluded.conversations_analyzed,
         failure_rate = excluded.failure_rate,
         health_score = excluded.health_score,
         report = excluded.report,
         model = excluded.model`,
    )
    .bind(
      r.site,
      r.generated_at,
      r.window_days,
      r.conversations_analyzed,
      r.failure_rate,
      r.health_score,
      r.report,
      r.model,
    )
    .run();
}

// ── Alert log ────────────────────────────────────────────────────────────────

export async function logAlert(
  db: D1Database,
  kind: string,
  site: string | null,
  ip: string | null,
  detail: string,
): Promise<void> {
  await db
    .prepare(`INSERT INTO alert_log (site, ip, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(site, ip, kind, detail, nowIso())
    .run();
}

export async function alreadyAlerted(
  db: D1Database,
  kind: string,
  site: string,
  ip: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM alert_log WHERE kind = ? AND site = ? AND ip = ? LIMIT 1`)
    .bind(kind, site, ip)
    .first<{ x: number }>();
  return !!row;
}
