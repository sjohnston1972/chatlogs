export interface SiteSummary {
  site: string;
  conversations: number;
  requests: number;
  last_activity: string | null;
  spark: number[];
}

export interface ActivityStats {
  total_conversations: number;
  total_requests: number;
  conversations_24h: number;
  conversations_7d: number;
  requests_24h: number;
  requests_7d: number;
}

export interface AnalysisSummary {
  summary: string;
  intent: string;
  sentiment: string;
  lead_score: number;
  is_lead: boolean;
  bot_failed: boolean;
  topics: string[];
  model?: string;
  analyzed_at?: string;
}

export interface TriageState {
  is_read: boolean;
  starred: boolean;
  archived: boolean;
  lead_status: string | null;
  note: string | null;
  tags: string[];
}

export interface GeoInfo {
  country: string | null;
  country_code: string | null;
  region?: string | null;
  city: string | null;
  org?: string | null;
}

export interface ConversationListItem {
  site: string;
  ip: string;
  request_count: number;
  created_at: string;
  updated_at: string;
  preview: string;
  cta: boolean;
  message_count: number;
  analysis: AnalysisSummary | null;
  triage: TriageState;
  geo: GeoInfo | null;
}

export interface ConversationListResult {
  items: ConversationListItem[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
}

export interface TranscriptMessage {
  role: string;
  content: string;
}

export interface ConversationDetail {
  site: string;
  ip: string;
  request_count: number;
  created_at: string;
  updated_at: string;
  cta: boolean;
  messages: TranscriptMessage[];
  analysis: AnalysisSummary | null;
  triage: TriageState;
  geo: GeoInfo | null;
}

export interface Breakdown {
  key: string;
  count: number;
}

export interface DailyPoint {
  day: string;
  conversations: number;
  requests: number;
}

export interface HeatCell {
  dow: number;
  hour: number;
  count: number;
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

export interface Analytics {
  series: DailyPoint[];
  cta: { conversations: number; cta: number; rate: number };
  heat: HeatCell[];
  scores: SiteScore[];
  intents: Breakdown[];
  sentiments: Breakdown[];
  leads: { analyzed: number; leads: number; bot_failures: number; avg_lead_score: number };
  geo: Breakdown[];
  days: number;
}

export interface AskResult {
  answer: string;
  queries: string[];
}

export interface Gap {
  theme: string;
  severity: "high" | "medium" | "low";
  frequency: number;
  example_ip: string;
  diagnosis: string;
  fix_type: "faq" | "system_prompt" | "escalation";
  suggested_fix: string;
}

export interface BotReportContent {
  headline: string;
  gaps: Gap[];
  system_prompt_additions: string[];
  faq_suggestions: { q: string; a: string }[];
}

export interface BotReport {
  site: string;
  generated_at?: string;
  window_days?: number;
  conversations_analyzed?: number;
  failure_rate?: number;
  health_score?: number;
  model?: string;
  report: BotReportContent | null;
}
