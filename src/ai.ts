import type { Env, TranscriptMessage } from "./types";

/**
 * Anthropic Messages API integration (raw fetch — keeps the Worker bundle lean).
 *
 * Two surfaces:
 *  - analyzeConversation(): cheap per-conversation classification/summary/scoring.
 *    Defaults to Haiku 4.5 (high volume, runs on cron). Override with ANALYSIS_MODEL.
 *  - askLogs(): interactive "ask your logs" — a small read-only SQL agent loop.
 *    Defaults to Opus 4.8 (low volume, benefits from reasoning). Override with ASK_MODEL.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const DEFAULT_ANALYSIS_MODEL = "claude-haiku-4-5";
const DEFAULT_ASK_MODEL = "claude-opus-4-8";

export const INTENTS = [
  "pricing",
  "support",
  "booking",
  "lead",
  "complaint",
  "smalltalk",
  "other",
] as const;

export const SENTIMENTS = ["positive", "neutral", "negative", "frustrated"] as const;

export interface AnalysisResult {
  summary: string;
  intent: string;
  sentiment: string;
  lead_score: number;
  is_lead: boolean;
  bot_failed: boolean;
  topics: string[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

export async function callAnthropic(
  env: Env,
  body: Record<string, unknown>,
): Promise<AnthropicResponse> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as AnthropicResponse;
}

function transcriptToText(messages: TranscriptMessage[], cta: boolean): string {
  const lines = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  return `CTA flag from site: ${cta}\n\n${lines.join("\n\n")}`;
}

const ANALYSIS_TOOL = {
  name: "record_analysis",
  description: "Record the structured analysis of a single chatbot conversation.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One sentence (max ~20 words) summarizing what the visitor wanted and the outcome.",
      },
      intent: {
        type: "string",
        enum: INTENTS as unknown as string[],
        description: "The visitor's primary intent.",
      },
      sentiment: {
        type: "string",
        enum: SENTIMENTS as unknown as string[],
        description: "Overall visitor sentiment across the conversation.",
      },
      lead_score: {
        type: "integer",
        description: "0-100 likelihood this visitor is a sales lead with buying intent.",
      },
      is_lead: {
        type: "boolean",
        description: "True if this is a genuine sales/booking lead worth following up.",
      },
      bot_failed: {
        type: "boolean",
        description: "True if the assistant failed to answer or was unhelpful at some point.",
      },
      topics: {
        type: "array",
        items: { type: "string" },
        description: "1-5 short topic keywords (lowercase).",
      },
    },
    required: ["summary", "intent", "sentiment", "lead_score", "is_lead", "bot_failed", "topics"],
  },
};

const ANALYSIS_SYSTEM =
  "You analyze transcripts of conversations between website visitors and a site's AI chatbot. " +
  "You review them on behalf of the site owner. Be concise and objective. " +
  "Always call the record_analysis tool with your structured assessment.";

/** Analyze a single conversation. Returns null on hard failure (caller skips). */
export async function analyzeConversation(
  env: Env,
  site: string,
  messages: TranscriptMessage[],
  cta: boolean,
): Promise<AnalysisResult | null> {
  const model = env.ANALYSIS_MODEL || DEFAULT_ANALYSIS_MODEL;
  const resp = await callAnthropic(env, {
    model,
    max_tokens: 1024,
    system: ANALYSIS_SYSTEM,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "record_analysis", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: `Site: ${site}\n\nTranscript:\n${transcriptToText(messages, cta)}`,
      },
    ],
  });

  const block = resp.content?.find((b) => b.type === "tool_use" && b.name === "record_analysis");
  if (!block?.input) return null;
  const a = block.input as Partial<AnalysisResult>;

  // Validate / clamp.
  const intent = INTENTS.includes(a.intent as (typeof INTENTS)[number]) ? a.intent! : "other";
  const sentiment = SENTIMENTS.includes(a.sentiment as (typeof SENTIMENTS)[number])
    ? a.sentiment!
    : "neutral";
  const lead = Math.max(0, Math.min(100, Math.round(Number(a.lead_score) || 0)));

  return {
    summary: String(a.summary ?? "").slice(0, 400),
    intent,
    sentiment,
    lead_score: lead,
    is_lead: Boolean(a.is_lead),
    bot_failed: Boolean(a.bot_failed),
    topics: Array.isArray(a.topics) ? a.topics.slice(0, 5).map((t) => String(t).toLowerCase()) : [],
  };
}

/** Build a one-line digest narrative from aggregate stats (Opus, low volume). */
export async function summarizeDigest(env: Env, statsJson: string): Promise<string> {
  const model = env.ASK_MODEL || DEFAULT_ASK_MODEL;
  const resp = await callAnthropic(env, {
    model,
    max_tokens: 700,
    system:
      "You write a concise daily digest for the owner of several websites with AI chatbots. " +
      "Given JSON activity stats, write 3-6 short sentences highlighting what matters: volume, " +
      "notable leads, negative sentiment, and any site that went quiet. Plain text, no markdown headers.",
    messages: [{ role: "user", content: `Stats for the last 24h:\n${statsJson}` }],
  });
  return resp.content?.find((b) => b.type === "text")?.text ?? "No digest available.";
}

// ── Ask-your-logs: a bounded read-only SQL agent loop ────────────────────────

const SQL_TOOL = {
  name: "run_sql",
  description:
    "Run a single read-only SQL SELECT against the chat_logs table and get rows back as JSON. " +
    "Only SELECT is allowed. The table chat_logs has columns: site TEXT, ip TEXT, created_at TEXT (ISO), " +
    "updated_at TEXT (ISO), request_count INTEGER, transcript TEXT (JSON with messages[] and cta). " +
    "Use LIKE on transcript for content search. Always include a LIMIT.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single SQLite SELECT statement." },
    },
    required: ["sql"],
  },
};

/** Guard: only allow a single read-only SELECT. */
export function isSafeSelect(sql: string): boolean {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (/;/.test(s)) return false; // no multiple statements
  if (!/^select\b/i.test(s)) return false;
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace|vacuum)\b/i.test(s)) {
    return false;
  }
  return true;
}

export interface AskResult {
  answer: string;
  queries: string[];
}

/**
 * Answer a natural-language question about the logs. Opus may call run_sql
 * (guarded, read-only) up to `maxSteps` times, then answers in prose.
 */
export async function askLogs(
  env: Env,
  question: string,
  runQuery: (sql: string) => Promise<unknown[]>,
  maxSteps = 4,
): Promise<AskResult> {
  const model = env.ASK_MODEL || DEFAULT_ASK_MODEL;
  const queries: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: question }];

  for (let step = 0; step < maxSteps; step++) {
    const resp = await callAnthropic(env, {
      model,
      max_tokens: 1500,
      system:
        "You answer questions about chatbot conversation logs for the site owner. " +
        "Use the run_sql tool (read-only SELECT on chat_logs) to gather data, then answer " +
        "concisely in plain text with concrete numbers. Lead with the answer.",
      tools: [SQL_TOOL],
      messages,
    });

    messages.push({ role: "assistant", content: resp.content ?? [] });

    const toolUse = resp.content?.find((b) => b.type === "tool_use" && b.name === "run_sql");
    if (resp.stop_reason !== "tool_use" || !toolUse) {
      const answer = resp.content?.find((b) => b.type === "text")?.text ?? "No answer.";
      return { answer, queries };
    }

    const sql = String((toolUse.input as { sql?: string })?.sql ?? "");
    let resultContent: string;
    if (!isSafeSelect(sql)) {
      resultContent = "ERROR: only a single read-only SELECT statement is allowed.";
    } else {
      queries.push(sql);
      try {
        const rows = await runQuery(sql);
        resultContent = JSON.stringify(rows).slice(0, 8000);
      } catch (e) {
        resultContent = `ERROR: ${e instanceof Error ? e.message : "query failed"}`;
      }
    }

    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUse.id, content: resultContent }],
    });
  }

  // Ran out of steps — ask for a final answer with no tools.
  const final = await callAnthropic(env, {
    model,
    max_tokens: 1000,
    system: "Answer the user's question using what you've gathered. Plain text, concise.",
    messages: [...messages, { role: "user", content: "Give your best final answer now." }],
  });
  return { answer: final.content?.find((b) => b.type === "text")?.text ?? "No answer.", queries };
}
