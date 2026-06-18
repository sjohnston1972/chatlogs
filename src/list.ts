import type { Env } from "./types";
import {
  getConversation,
  getConversations,
  type ConversationListParams,
  type ConversationListResult,
} from "./db";
import {
  getAnalysesFor,
  getFilterKeys,
  getGeoFor,
  getTriageFor,
  getAnalysis,
  getTriage,
  hasKeyFilters,
  type KeyFilters,
} from "./dashdb";
import { analyzeOne } from "./pipeline";

function topicsArr(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function tagsArr(json: string | null | undefined): string[] {
  return topicsArr(json);
}

/** Conversations list, filtered (incl. AI/triage) and enriched from DASH_DB. */
export async function listConversations(
  env: Env,
  params: ConversationListParams,
  filters: KeyFilters,
): Promise<ConversationListResult & { keysCapped: boolean }> {
  let keys: string[] | null = null;
  let keysCapped = false;
  if (hasKeyFilters(filters)) {
    keys = await getFilterKeys(env.DASH_DB, filters, 1000);
    keysCapped = keys.length === 1000;
  }

  const result = await getConversations(env.DB, { ...params, keys });

  const keyObjs = result.items.map((i) => ({ site: i.site, ip: i.ip }));
  const [analyses, triages, geo] = await Promise.all([
    getAnalysesFor(env.DASH_DB, keyObjs),
    getTriageFor(env.DASH_DB, keyObjs),
    getGeoFor(env.DASH_DB, keyObjs.map((k) => k.ip)),
  ]);

  const items = result.items.map((i) => {
    const a = analyses.get(`${i.site}|${i.ip}`);
    const t = triages.get(`${i.site}|${i.ip}`);
    const g = geo.get(i.ip);
    return {
      ...i,
      analysis: a
        ? {
            summary: a.summary,
            intent: a.intent,
            sentiment: a.sentiment,
            lead_score: a.lead_score,
            is_lead: !!a.is_lead,
            bot_failed: !!a.bot_failed,
            topics: topicsArr(a.topics),
          }
        : null,
      triage: {
        is_read: !!t?.is_read,
        starred: !!t?.starred,
        archived: !!t?.archived,
        lead_status: t?.lead_status ?? null,
        note: t?.note ?? null,
        tags: tagsArr(t?.tags),
      },
      geo: g ? { country: g.country, country_code: g.country_code, city: g.city } : null,
    };
  });

  return { ...result, items: items as unknown as typeof result.items, keysCapped };
}

/** Conversation detail enriched with analysis + triage + geo; lazily analyzes. */
export async function detailConversation(env: Env, site: string, ip: string) {
  const detail = await getConversation(env.DB, site, ip);
  if (!detail) return null;

  // Lazy analysis: analyze on first view if missing/stale (best-effort).
  try {
    await analyzeOne(env, site, ip);
  } catch (e) {
    console.error("lazy_analyze_error", String(e));
  }

  const [a, t, geoMap] = await Promise.all([
    getAnalysis(env.DASH_DB, site, ip),
    getTriage(env.DASH_DB, site, ip),
    getGeoFor(env.DASH_DB, [ip]),
  ]);
  const g = geoMap.get(ip);

  return {
    ...detail,
    analysis: a
      ? {
          summary: a.summary,
          intent: a.intent,
          sentiment: a.sentiment,
          lead_score: a.lead_score,
          is_lead: !!a.is_lead,
          bot_failed: !!a.bot_failed,
          topics: topicsArr(a.topics),
          model: a.model,
          analyzed_at: a.analyzed_at,
        }
      : null,
    triage: {
      is_read: !!t?.is_read,
      starred: !!t?.starred,
      archived: !!t?.archived,
      lead_status: t?.lead_status ?? null,
      note: t?.note ?? null,
      tags: tagsArr(t?.tags),
    },
    geo: g
      ? { country: g.country, country_code: g.country_code, region: g.region, city: g.city, org: g.org }
      : null,
  };
}
