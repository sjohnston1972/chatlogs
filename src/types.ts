/** Worker environment bindings (see wrangler.jsonc). */
export interface Env {
  /** Read-only access to the shared chat-logs D1 database. */
  DB: D1Database;
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
