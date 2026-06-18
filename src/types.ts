/** Worker environment bindings (see wrangler.jsonc). */
export interface Env {
  /** Read-only access to the shared chat-logs D1 database. SELECT only. */
  DB: D1Database;
  /** Dashboard-owned D1 database (analysis cache, triage, geo, meta). Writable. */
  DASH_DB: D1Database;
  /** Static assets binding serving the built React SPA (web/dist). */
  ASSETS: Fetcher;
  /** Cloudflare Access team domain, e.g. "clydeford.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /**
   * Access Application Audience (AUD) tag. When set, the Worker verifies the
   * Cf-Access-Jwt-Assertion JWT on every /api request (defense-in-depth on top
   * of edge-enforced Access). Set via: wrangler secret put ACCESS_AUD.
   */
  ACCESS_AUD?: string;

  /** Anthropic API key for conversation analysis + ask-your-logs. Secret. */
  ANTHROPIC_API_KEY?: string;
  /** Model for per-conversation analysis (default claude-haiku-4-5). */
  ANALYSIS_MODEL?: string;
  /** Model for ask-your-logs + digest (default claude-opus-4-8). */
  ASK_MODEL?: string;

  /** Email digest/alert recipient + sender (Cloudflare Email Routing). */
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
  /** Cloudflare Email Routing send binding (optional; alerts disabled if absent). */
  SEND_EMAIL?: SendEmail;
}

/** Cloudflare Email Routing send_email binding shape. */
export interface SendEmail {
  send(message: unknown): Promise<void>;
}

/** A computed conversation analysis row (dashboard DB). */
export interface Analysis {
  site: string;
  ip: string;
  source_updated_at: string;
  summary: string;
  intent: string;
  sentiment: string;
  lead_score: number;
  is_lead: number;
  bot_failed: number;
  topics: string; // JSON array
  model: string;
  analyzed_at: string;
}

/** Triage state for a conversation (dashboard DB). */
export interface Triage {
  site: string;
  ip: string;
  is_read: number;
  starred: number;
  archived: number;
  lead_status: string | null;
  note: string | null;
  tags: string | null; // JSON array
  updated_at: string;
}

/** A single message turn within a transcript. */
export interface TranscriptMessage {
  role: string;
  content: string;
}

/** Parsed transcript JSON stored in the `transcript` column. */
export interface Transcript {
  messages: TranscriptMessage[];
  cta?: boolean;
}

/** A raw row of the chat_logs table. */
export interface ChatLogRow {
  site: string;
  ip: string;
  created_at: string;
  updated_at: string;
  request_count: number;
  transcript: string;
}
