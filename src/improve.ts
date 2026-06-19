import type { Env } from "./types";
import { callAnthropic } from "./ai";
import { upsertBotReport, type BotReportRow } from "./dashdb";
import { parseTranscript } from "./db";

/**
 * Bot-improvement synthesis (Phase B). For one site, gather a bounded sample of
 * recent conversations (failures/negatives prioritised), ask Claude to cluster
 * them into content gaps with concrete fixes + system-prompt/FAQ suggestions,
 * compute a health score, and store the report. Read-only on chat_logs.
 */

const DEFAULT_MODEL = "claude-opus-4-8";
const WINDOW_DAYS = 30;
const MAX_FLAGGED = 28;
const MAX_HEALTHY = 8;
const MAX_TRANSCRIPT_CHARS = 1600;

interface AnalysisLite {
  ip: string;
  source_updated_at: string;
  summary: string;
  intent: string;
  sentiment: string;
  lead_score: number;
  is_lead: number;
  bot_failed: number;
}

const REPORT_TOOL = {
  name: "report_improvements",
  description: "Report how to improve this site's chatbot based on real conversations.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence on the state of this bot." },
      gaps: {
        type: "array",
        description: "Ranked content gaps / failure themes, most impactful first.",
        items: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short name for the gap." },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            frequency: { type: "integer", description: "How many sampled conversations show this." },
            example_ip: { type: "string", description: "IP of one representative conversation, or empty." },
            diagnosis: { type: "string", description: "Why the bot is falling short here." },
            fix_type: { type: "string", enum: ["faq", "system_prompt", "escalation"] },
            suggested_fix: { type: "string", description: "Concrete fix the owner can apply." },
          },
          required: ["theme", "severity", "frequency", "example_ip", "diagnosis", "fix_type", "suggested_fix"],
        },
      },
      system_prompt_additions: {
        type: "array",
        items: { type: "string" },
        description: "Ready-to-paste lines to add to the bot's system prompt.",
      },
      faq_suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: { q: { type: "string" }, a: { type: "string" } },
          required: ["q", "a"],
        },
        description: "Suggested FAQ question/answer pairs to add to the bot's knowledge.",
      },
    },
    required: ["headline", "gaps", "system_prompt_additions", "faq_suggestions"],
  },
};

function healthScore(analyzed: number, failures: number, negatives: number): number {
  if (analyzed === 0) return 0;
  const score = 100 - (failures / analyzed) * 60 - (negatives / analyzed) * 30;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function generateReport(env: Env, site: string): Promise<BotReportRow> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("AI not configured");
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  const { results } = await env.DASH_DB.prepare(
    `SELECT ip, source_updated_at, summary, intent, sentiment, lead_score, is_lead, bot_failed
     FROM analysis WHERE site = ? AND source_updated_at >= ?
     ORDER BY bot_failed DESC, source_updated_at DESC`,
  )
    .bind(site, since)
    .all<AnalysisLite>();
  const rows = results ?? [];

  const analyzed = rows.length;
  const failures = rows.filter((r) => r.bot_failed).length;
  const negatives = rows.filter((r) => r.sentiment === "negative" || r.sentiment === "frustrated").length;
  const failure_rate = analyzed ? failures / analyzed : 0;
  const health = healthScore(analyzed, failures, negatives);

  const isFlagged = (r: AnalysisLite) =>
    r.bot_failed === 1 || r.sentiment === "negative" || r.sentiment === "frustrated";
  const flagged = rows.filter(isFlagged).slice(0, MAX_FLAGGED);
  const healthy = rows.filter((r) => !isFlagged(r)).slice(0, MAX_HEALTHY);

  // Fetch transcripts for the flagged sample (full detail helps gap detection).
  const flaggedIps = flagged.map((r) => r.ip);
  const transcripts = new Map<string, string>();
  if (flaggedIps.length) {
    const placeholders = flaggedIps.map(() => "?").join(",");
    const { results: tx } = await env.DB.prepare(
      `SELECT ip, transcript FROM chat_logs WHERE site = ? AND ip IN (${placeholders})`,
    )
      .bind(site, ...flaggedIps)
      .all<{ ip: string; transcript: string }>();
    for (const t of tx ?? []) {
      const parsed = parseTranscript(t.transcript);
      const text = parsed.messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n")
        .slice(0, MAX_TRANSCRIPT_CHARS);
      transcripts.set(t.ip, text);
    }
  }

  // Build the sample payload for the model.
  const lines: string[] = [];
  for (const r of [...flagged, ...healthy]) {
    lines.push(
      `--- conversation (ip ${r.ip}) | intent=${r.intent} sentiment=${r.sentiment} bot_failed=${r.bot_failed ? "yes" : "no"} lead=${r.lead_score}\n` +
        `summary: ${r.summary}` +
        (transcripts.has(r.ip) ? `\ntranscript:\n${transcripts.get(r.ip)}` : ""),
    );
  }

  const fullTranscripts = transcripts.size > 0;
  const note = fullTranscripts
    ? ""
    : " NOTE: transcripts are single-turn only (logging not yet upgraded), so infer gaps from summaries.";

  const model = env.ASK_MODEL || DEFAULT_MODEL;
  const resp = await callAnthropic(env, {
    model,
    max_tokens: 2500,
    system:
      "You analyze real conversations between visitors and a website's AI chatbot, on behalf of the site owner, " +
      "to find where the bot falls short and exactly how to improve it. Focus on recurring content gaps, " +
      "unanswered questions, and failure patterns. Be specific and practical; suggested fixes must be directly " +
      "usable (paste-ready). Always call the report_improvements tool." +
      note,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: "report_improvements", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content:
          `Site: ${site}\nConversations analyzed in window: ${analyzed} (failures: ${failures}, negative: ${negatives}).\n\n` +
          `Here is a sample of recent conversations:\n\n${lines.join("\n\n")}`,
      },
    ],
  });

  const block = resp.content?.find((b) => b.type === "tool_use" && b.name === "report_improvements");
  const report = (block?.input as unknown) ?? {
    headline: "No clear gaps found in the sample.",
    gaps: [],
    system_prompt_additions: [],
    faq_suggestions: [],
  };

  const row: BotReportRow = {
    site,
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    conversations_analyzed: analyzed,
    failure_rate,
    health_score: health,
    report: JSON.stringify(report),
    model,
  };
  await upsertBotReport(env.DASH_DB, row);
  return row;
}
