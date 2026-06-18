import type { Env } from "./types";
import type { AnalyzedItem } from "./pipeline";
import { alreadyAlerted, getMeta, logAlert, setMeta } from "./dashdb";
import { getActivity, getSites } from "./db";
import { intentBreakdown, leadStats, sentimentBreakdown } from "./analytics";
import { summarizeDigest } from "./ai";
import { sendEmail } from "./email";

const HOT_LEAD_SCORE = 70;
const DASH_URL = "https://chatlogs.clydeford.net";

/**
 * Real-time alerts: from the items just analyzed, flag hot leads, negative
 * sentiment, and bot failures. De-duped via alert_log so each conversation
 * alerts at most once per kind. Batched into a single email per run.
 */
export async function runAlerts(env: Env, analyzed: AnalyzedItem[]): Promise<void> {
  if (analyzed.length === 0) return;
  const fresh: string[] = [];

  for (const item of analyzed) {
    const { site, ip, result } = item;
    if (result.is_lead && result.lead_score >= HOT_LEAD_SCORE) {
      if (!(await alreadyAlerted(env.DASH_DB, "hot_lead", site, ip))) {
        await logAlert(env.DASH_DB, "hot_lead", site, ip, `score ${result.lead_score}: ${result.summary}`);
        fresh.push(`🔥 HOT LEAD (${result.lead_score}) — ${site}\n   ${result.summary}\n   ${DASH_URL}/conversation?site=${encodeURIComponent(site)}&ip=${encodeURIComponent(ip)}`);
      }
    }
    if (result.sentiment === "frustrated" || result.sentiment === "negative") {
      if (!(await alreadyAlerted(env.DASH_DB, "negative", site, ip))) {
        await logAlert(env.DASH_DB, "negative", site, ip, result.summary);
        fresh.push(`⚠️ ${result.sentiment.toUpperCase()} visitor — ${site}\n   ${result.summary}`);
      }
    }
    if (result.bot_failed) {
      if (!(await alreadyAlerted(env.DASH_DB, "bot_failed", site, ip))) {
        await logAlert(env.DASH_DB, "bot_failed", site, ip, result.summary);
        fresh.push(`🤖 BOT FAILED to help — ${site}\n   ${result.summary}`);
      }
    }
  }

  if (fresh.length === 0) return;
  const body =
    `New chatbot signals just detected:\n\n${fresh.join("\n\n")}\n\n— chatlogs (${DASH_URL})`;
  await sendEmail(env, `chatlogs: ${fresh.length} new signal${fresh.length > 1 ? "s" : ""}`, body);
}

/**
 * Daily digest: 24h activity + lead/sentiment summary + silence detection,
 * narrated by the LLM and emailed. Guarded so it sends at most once per day.
 */
export async function runDigest(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if ((await getMeta(env.DASH_DB, "last_digest_day")) === today) return;

  const [activity, sites, intents, sentiments, leads] = await Promise.all([
    getActivity(env.DB, null),
    getSites(env.DB),
    intentBreakdown(env.DASH_DB, null),
    sentimentBreakdown(env.DASH_DB, null),
    leadStats(env.DASH_DB, null),
  ]);

  // Silence detection: sites with history but no activity in the last 24h.
  const dayAgo = Date.now() - 24 * 3600_000;
  const quiet = sites
    .filter((s) => s.last_activity && new Date(s.last_activity).getTime() < dayAgo)
    .map((s) => s.site);

  const stats = {
    conversations_24h: activity.conversations_24h,
    requests_24h: activity.requests_24h,
    conversations_7d: activity.conversations_7d,
    total_conversations: activity.total_conversations,
    sites: sites.map((s) => ({ site: s.site, conversations: s.conversations })),
    intents,
    sentiments,
    leads,
    quiet_sites: quiet,
  };

  let narrative: string;
  try {
    narrative = await summarizeDigest(env, JSON.stringify(stats, null, 2));
  } catch (e) {
    narrative = `Digest generation failed: ${String(e)}`;
  }

  const body = `${narrative}\n\n— chatlogs daily digest · ${DASH_URL}`;
  const sent = await sendEmail(env, `chatlogs daily digest — ${today}`, body);
  await logAlert(env.DASH_DB, "digest", null, null, sent ? "sent" : "email not configured");
  await setMeta(env.DASH_DB, "last_digest_day", today);
}
