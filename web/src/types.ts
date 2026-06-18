export interface SiteSummary {
  site: string;
  conversations: number;
  requests: number;
  last_activity: string | null;
}

export interface ActivityStats {
  total_conversations: number;
  total_requests: number;
  conversations_24h: number;
  conversations_7d: number;
  requests_24h: number;
  requests_7d: number;
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
}
