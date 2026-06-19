# Spec: Bot-Improvement Loop

## Goal
Turn observed conversations into **concrete, actionable improvements for each site's chatbot**. Instead of only *watching* what bots do, the dashboard tells the owner *where each bot is failing and exactly what to change* — content gaps, suggested FAQ answers, and proposed system-prompt additions. This shifts the tool's category from "dashboard" to "makes my bots better."

## Non-goals (deliberate boundaries)
- **No auto-applying changes.** The dashboard has no connection to the bots' deployments and stays a read-only observer of `chat_logs`. It produces copy-paste recommendations the owner applies manually. This keeps it safe and in-scope.
- **No new per-conversation AI cost.** It reuses the analysis already computed; synthesis is one extra call per site per run.
- **Not a replacement for the logging fix.** It works on current data but is materially better once full transcripts accumulate (see Dependencies).

## How it works

### Inputs (already available)
- Per-conversation analysis: `summary, intent, sentiment, lead_score, bot_failed, topics` (in `DASH_DB.analysis`).
- Full transcripts in `chat_logs` (read-only).

### Two-phase design
- **Phase A — per-conversation (exists today).** The cron already flags `bot_failed`, sentiment, intent, and summary per conversation. No change.
- **Phase B — site-level synthesis (new).** Periodically, per site:
  1. Gather a bounded sample of recent conversations within a window (default **30 days, cap ~40 conversations**), prioritising `bot_failed = 1`, negative/frustrated sentiment, and unmet intents; include a few healthy ones for contrast.
  2. Send their summaries (+ full transcript for the flagged ones, to bound tokens) to Claude (**Opus 4.8**, low volume) with a forced structured-output tool.
  3. Claude returns: ranked **content gaps / failure themes**, each with frequency, severity, a representative example (links to the conversation), and a **concrete suggested fix**; plus a set of **proposed system-prompt additions** and **FAQ Q&A snippets**.
  4. Store the structured report.

### Triggers
- **On-demand only.** A **Regenerate** button per site (`POST /api/improve?site=`) runs the synthesis and stores the report. No cron — zero idle cost; the owner refreshes when they want a fresh read (e.g. after changing a bot). The stored report persists until regenerated.

## Data model
New table in `DASH_DB` (migration `0002_improvements.sql`), one current report per site:

```sql
CREATE TABLE IF NOT EXISTS bot_reports (
  site                    TEXT PRIMARY KEY,
  generated_at            TEXT,
  window_days             INTEGER,
  conversations_analyzed  INTEGER,
  failure_rate            REAL,     -- bot_failed / analyzed in window
  health_score            INTEGER,  -- 0-100, derived
  report                  TEXT,     -- JSON (see below)
  model                   TEXT
);
```

`report` JSON shape:
```jsonc
{
  "headline": "One-line state of this bot.",
  "gaps": [
    {
      "theme": "SSO reset not handled",
      "severity": "high",            // high | medium | low
      "frequency": 4,                // # conversations in window
      "examples": [{ "ip": "...", "updated_at": "..." }],
      "diagnosis": "Bot points to docs but can't walk through the reset.",
      "fix_type": "faq" ,            // faq | system_prompt | escalation
      "suggested_fix": "Add an FAQ: 'How do I reset SSO?' → step-by-step…"
    }
  ],
  "system_prompt_additions": ["When a user reports SSO errors, give the 4-step reset…"],
  "faq_suggestions": [{ "q": "...", "a": "..." }]
}
```

## API
- `GET /api/improve?site=<site>` → latest stored `bot_reports` row for the site (404 if none yet).
- `POST /api/improve?site=<site>` → run Phase B now for that site, store, and return the report. (Behind Access like all `/api`.)
- Both read-only on `chat_logs`; writes only to `DASH_DB.bot_reports`.

## UI — new "Improve" tab
Top-nav adds **Improve**. Layout per selected site:
- **Bot health header**: health score (0-100), failure rate, # conversations analyzed, last generated time, **Regenerate** button.
- **Content gaps** list: each gap as a card — severity badge (reusing the heat colours), frequency, diagnosis, a representative example linking to the conversation detail, and the suggested fix in a **copyable code block**.
- **Proposed system-prompt additions** and **FAQ snippets**: copyable blocks ("Copy" button) the owner pastes into their bot.
- Empty state: "No report yet — Regenerate to analyse this site."

## Dependencies & risks
- **Logging fix is the multiplier.** With single-turn transcripts (current real data), gap detection is weaker. It still produces value, but the report quality jumps once full transcripts land. The report header will note transcript completeness.
- **Cost**: one Opus call per site per day + on-demand. With a handful of sites, negligible; token use bounded by the 40-conversation cap and summary-first sampling.
- **Accuracy is advisory.** Suggestions are recommendations, not truth. Pairs naturally with a future thumbs-up/down feedback loop (the "trust the signals" idea) to tune the synthesis prompt.

## Build phases
1. Migration + `bot_reports` store accessors.
2. `src/improve.ts` — gather sample, Phase B Claude call (structured), health-score calc.
3. API routes (`GET`/`POST /api/improve`) + daily cron branch.
4. `web` — Improve tab, gap cards, copyable fixes, health header.
5. Deploy, verify on the demo + real sites, README.
```
