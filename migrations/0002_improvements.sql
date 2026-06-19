-- Bot-improvement reports (one current report per site). Dashboard-owned DB only.
CREATE TABLE IF NOT EXISTS bot_reports (
  site                   TEXT PRIMARY KEY,
  generated_at           TEXT,
  window_days            INTEGER,
  conversations_analyzed INTEGER,
  failure_rate           REAL,
  health_score           INTEGER,
  report                 TEXT,   -- JSON: { headline, gaps[], system_prompt_additions[], faq_suggestions[] }
  model                  TEXT
);
