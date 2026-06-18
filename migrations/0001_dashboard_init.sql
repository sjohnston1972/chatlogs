-- Dashboard-owned schema. Applied ONLY to the chatlogs-dashboard D1 database.
-- The shared chat_logs database is never migrated or written to.

-- AI analysis cache, one row per conversation (site, ip).
CREATE TABLE IF NOT EXISTS analysis (
  site              TEXT    NOT NULL,
  ip                TEXT    NOT NULL,
  source_updated_at TEXT    NOT NULL,            -- chat_logs.updated_at this was computed from
  summary           TEXT,
  intent            TEXT,                         -- pricing|support|booking|lead|complaint|smalltalk|other
  sentiment         TEXT,                         -- positive|neutral|negative|frustrated
  lead_score        INTEGER DEFAULT 0,            -- 0-100
  is_lead           INTEGER DEFAULT 0,            -- 0/1
  bot_failed        INTEGER DEFAULT 0,            -- 0/1: assistant failed to help
  topics            TEXT,                         -- JSON array of keywords
  model             TEXT,
  analyzed_at       TEXT,
  PRIMARY KEY (site, ip)
);
CREATE INDEX IF NOT EXISTS idx_analysis_intent    ON analysis(intent);
CREATE INDEX IF NOT EXISTS idx_analysis_sentiment ON analysis(sentiment);
CREATE INDEX IF NOT EXISTS idx_analysis_lead      ON analysis(is_lead);
CREATE INDEX IF NOT EXISTS idx_analysis_failed    ON analysis(bot_failed);

-- Manual triage state, one row per conversation.
CREATE TABLE IF NOT EXISTS triage (
  site        TEXT NOT NULL,
  ip          TEXT NOT NULL,
  is_read     INTEGER DEFAULT 0,
  starred     INTEGER DEFAULT 0,
  archived    INTEGER DEFAULT 0,
  lead_status TEXT,                                -- new|contacted|closed
  note        TEXT,
  tags        TEXT,                                -- JSON array of manual tags
  updated_at  TEXT,
  PRIMARY KEY (site, ip)
);
CREATE INDEX IF NOT EXISTS idx_triage_starred ON triage(starred);
CREATE INDEX IF NOT EXISTS idx_triage_status  ON triage(lead_status);

-- IP -> geo cache (best-effort enrichment).
CREATE TABLE IF NOT EXISTS geo (
  ip           TEXT PRIMARY KEY,
  country      TEXT,
  country_code TEXT,
  region       TEXT,
  city         TEXT,
  asn          TEXT,
  org          TEXT,
  looked_up_at TEXT
);

-- Key/value store for cursors + digest bookkeeping.
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Audit trail of alerts/digests sent (also used to de-dupe alerts).
CREATE TABLE IF NOT EXISTS alert_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site       TEXT,
  ip         TEXT,
  kind       TEXT,                                 -- cta|hot_lead|negative|silence|digest
  detail     TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_kind ON alert_log(kind, created_at);
