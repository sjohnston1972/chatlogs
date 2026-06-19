# chatlogs — chat-logs admin dashboard

A private, **read-only** admin dashboard (Cloudflare Worker) for reviewing chatbot
transcripts logged by your various website chatbots. All chatbots write to one
shared Cloudflare D1 database (`chat-logs`); this dashboard only ever `SELECT`s
from it.

- **Live URL:** https://chatlogs.clydeford.net
- **Auth:** Cloudflare Access (Zero Trust) — only `stevie.johnston@gmail.com`
- **Stack:** Cloudflare Worker (TypeScript) + React/Vite SPA served via the ASSETS binding
- **Source DB:** existing D1 `chat-logs` (`9c83ca62-df07-4e1c-979c-f559f7bc8b4a`), bound **read-only**
- **Dashboard DB:** D1 `chatlogs-dashboard` (`fc0ca3d3-b87b-44c3-8f0d-6685c1105b37`) — the dashboard's own writable store for AI analysis, triage state, geo cache, and alerts. The shared `chat_logs` DB is never written to.
- **AI:** Anthropic API — per-conversation analysis (Haiku 4.5), ask-your-logs + digest (Opus 4.8)

> **Two layers.** v1 is the read-only viewer. v2 adds an **intelligence layer**: a Cron-driven pipeline that analyzes every conversation with Claude (summary, intent, sentiment, lead score, bot-failure detection), analytics dashboards, a natural-language "ask your logs" query interface, triage workflow (star/read/archive/notes/lead-status), and email alerts/digests.

---

## What it does

1. **Sites** (landing) — every site (`SELECT DISTINCT site`) as a card with its
   conversation count, total request count, and last-activity time.
2. **Conversations** — list filterable by site, with free-text search across the
   transcript, a date-range filter on `updated_at`, sortable columns
   (updated_at default desc, also created_at / request_count), a one-line preview
   (first user message), a `cta` badge, and pagination (50/page).
3. **Conversation detail** — the full transcript rendered as a chat thread
   (visitor vs assistant turns), the `cta` flag, and all metadata.
4. **Activity ribbon** — last-24h / 7d conversation counts plus all-time totals,
   pinned in the top bar.

---

## Architecture

```
Request → chatlogs.clydeford.net
        → Cloudflare Access (edge)         ← blocks anyone who isn't the allowed identity
        → Worker (src/index.ts)
             /api/*  → verify Access JWT (defense-in-depth) → read-only D1 query → JSON
             else    → env.ASSETS.fetch()  → React SPA (web/dist)
```

- **Read-only & injection-safe.** Every D1 call in `src/db.ts` is a `SELECT` built
  with prepared statements and `.bind()`. User input is never interpolated into
  SQL. The only dynamic SQL fragments — sort column and direction — are validated
  against fixed whitelists.
- **Two layers of auth.** Cloudflare Access enforces identity at the edge
  (unauthenticated requests never reach the Worker). On top of that, when
  `ACCESS_AUD` is set the Worker independently verifies the signed
  `Cf-Access-Jwt-Assertion` JWT (issuer, audience, expiry, RS256 signature against
  the team JWKS) on every `/api` request — see `src/access.ts`.

### Project layout

```
wrangler.jsonc          Worker config: D1 binding, ASSETS binding, custom domain
src/
  index.ts              Worker entry — routing, auth gate, /api handlers, ASSETS fallback
  db.ts                 Read-only D1 query layer (prepared statements only)
  access.ts             Cloudflare Access JWT verification (defense-in-depth)
  types.ts              Shared types / Env bindings
web/                    React + Vite SPA (built to web/dist)
  src/components/        TopBar, SitesView, ConversationsView, ConversationView
  src/api.ts, router.ts, format.ts, styles.css
```

---

## Local development

```bash
npm install

# Terminal 1 — Worker + remote D1 (reads the real shared DB, read-only):
npm run dev            # wrangler dev  (http://127.0.0.1:8787)

# Terminal 2 — SPA with hot reload, /api proxied to the worker above:
npm run dev:web        # vite          (http://127.0.0.1:5173)
```

Wrangler authenticates from the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
environment variables (kept in `.env`, which is git-ignored). Load them into your
shell before running wrangler, e.g. `export $(grep -v '^#' .env | xargs)` on
bash, or set them in your environment manager of choice.

> During local dev there is no Cloudflare Access in front of you, and `ACCESS_AUD`
> is not set locally, so the Worker skips JWT verification. That is expected — the
> deployed Worker behind Access is fully protected.

---

## Build & deploy

```bash
npm run deploy         # vite build  →  wrangler deploy
```

`wrangler deploy` uploads the Worker + the built SPA assets and provisions the
custom domain route `chatlogs.clydeford.net` (the zone `clydeford.net` is on this
account). Confirmed working — see "Deployment status" below.

---

## Security — Cloudflare Access (the approach used)

This dashboard uses **Cloudflare Access** (the spec's preferred option), not Basic
Auth. The Zero Trust org `clydeford.cloudflareaccess.com` already existed on the
account, so a self-hosted Access application + an allow policy were created for the
hostname.

### What was set up

| Item | Value |
| --- | --- |
| Access app | `chatlogs` (self_hosted) |
| App domain | `chatlogs.clydeford.net` |
| App AUD | `11db930bcf0bd8502b3b768140368f896d354152f8df51c958e7184dc930691c` |
| Policy | `owner-only` — `decision: allow`, `include: email = stevie.johnston@gmail.com` |
| Session | 24h |
| Team domain | `clydeford.cloudflareaccess.com` |

### How to reproduce / modify via API

Create the app:

```bash
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" \
  --data '{
    "name": "chatlogs", "domain": "chatlogs.clydeford.net",
    "type": "self_hosted", "session_duration": "24h"
  }'
# → returns the app id and its "aud" tag
```

Attach an allow policy (use the app id from above):

```bash
curl -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/<APP_ID>/policies" \
  --data '{
    "name": "owner-only", "decision": "allow",
    "include": [ { "email": { "email": "stevie.johnston@gmail.com" } } ]
  }'
```

To **add another allowed person**, add another `{ "email": { "email": "..." } }`
object to the policy's `include` array (PUT the policy), or do it in the Zero Trust
dashboard: **Access → Applications → chatlogs → Policies**.

### Defense-in-depth JWT verification (already enabled)

The app's AUD is stored as a Worker secret so the Worker re-verifies the Access JWT:

```bash
printf '<APP_AUD>' | npx wrangler secret put ACCESS_AUD
```

(`ACCESS_TEAM_DOMAIN` is a plain var in `wrangler.jsonc`.) If `ACCESS_AUD` is ever
removed, the Worker falls back to trusting the edge Access policy alone.

### Verified: unauthenticated requests are blocked

```
$ curl -i https://chatlogs.clydeford.net/
HTTP/1.1 302 Found
Www-Authenticate: Cloudflare-Access ...
Location: https://clydeford.cloudflareaccess.com/cdn-cgi/access/login/chatlogs.clydeford.net?...

$ curl -i https://chatlogs.clydeford.net/api/sites
HTTP/1.1 302 Found
Location: https://clydeford.cloudflareaccess.com/cdn-cgi/access/login/chatlogs.clydeford.net?...
```

Both the SPA and the API return a 302 to the Access login (with `auth_status: NONE`)
— the Worker is never reached. Authenticating as `stevie.johnston@gmail.com`
(Cloudflare emails a one-time PIN) grants access.

---

## API reference (all read-only, all behind Access)

| Endpoint | Query params | Returns |
| --- | --- | --- |
| `GET /api/sites` | — | `{ sites: [{ site, conversations, requests, last_activity }] }` |
| `GET /api/activity` | `site?` | `{ total_conversations, total_requests, conversations_24h, conversations_7d, requests_24h, requests_7d }` |
| `GET /api/conversations` | `site? q? from? to? sort? dir? page? pageSize?` + AI/triage filters (`intent? sentiment? lead? failed? starred? archived? read?`) | `{ items[] (enriched w/ analysis+triage+geo), total, page, pageSize, keysCapped }` |
| `GET /api/conversation` | `site` `ip` (required) | full transcript + `analysis`, `triage`, `geo` (lazily analyzed) |
| `GET /api/analytics` | `site? days?` | `{ series, cta, heat, scores, intents, sentiments, leads, geo }` |
| `POST /api/ask` | `{ question }` | `{ answer, queries[] }` (read-only SQL agent) |
| `POST /api/triage` | `{ site, ip, is_read?, starred?, archived?, lead_status?, note?, tags? }` | `{ triage }` |
| `GET /api/improve` | `site` | stored bot-improvement report (or `{ report: null }`) |
| `POST /api/improve` | `site` | regenerate + return the report (Opus synthesis) |
| `GET /api/export` | conversation filters + `format=csv\|json` | downloadable export |
| `POST /api/admin/analyze` | `max?` | manually run the analysis pipeline (testing/backfill) |

`from`/`to` are ISO bounds compared against `updated_at`. `sort` ∈
{`updated_at`, `created_at`, `request_count`}; `dir` ∈ {`asc`, `desc`}.
`pageSize` is clamped to 1–200 (default 50).

---

## Intelligence layer (v2)

### AI analysis pipeline
- A **Cron Trigger** (`*/3 * * * *`) scans the most-recent conversations, and for any that are new or whose transcript changed, calls Claude to produce a structured analysis: one-line **summary**, **intent** (pricing/support/booking/lead/complaint/smalltalk/other), **sentiment** (positive/neutral/negative/frustrated), **lead score** (0–100) + is-lead flag, **bot-failure** flag, and topic keywords. Results are cached in `chatlogs-dashboard.analysis` keyed by `(site, ip)` and re-computed when the transcript changes.
- Conversations are also analyzed **lazily on first view** if the cache is missing/stale.
- **Model:** per-conversation analysis defaults to `claude-haiku-4-5` (cheap, high volume); ask-your-logs and the digest default to `claude-opus-4-8`. Override with the `ANALYSIS_MODEL` / `ASK_MODEL` vars.
- **Geo enrichment:** visitor IPs are resolved to country/city (via ipwho.is) and cached in `chatlogs-dashboard.geo` (best-effort, off the request path).

### Analytics
`GET /api/analytics` returns: conversations-over-time series, CTA conversion funnel, hour×weekday activity heatmap, per-site scorecards (avg messages, CTA rate), intent & sentiment breakdowns, lead stats, and visitor-by-country. Rendered as lightweight inline-SVG charts (no chart library).

### Ask your logs
`POST /api/ask` runs a bounded, **read-only** SQL agent: Claude may call a `run_sql` tool (guarded so only a single `SELECT` is allowed, auto-`LIMIT`ed) up to 4 times, then answers in plain English with real numbers. The guard (`isSafeSelect`) rejects anything that isn't a lone SELECT.

### Bot-improvement loop (Improve tab)
Turns observed conversations into **concrete fixes for each site's bot**. On demand (per-site **Generate/Regenerate** button → `POST /api/improve?site=`), Claude (Opus) reviews a bounded sample of recent conversations (failures/negatives prioritised, full transcripts for those), and returns a **bot-health score**, ranked **content gaps** (severity, frequency, a linked example, diagnosis, and a paste-ready fix), plus **system-prompt additions** and **FAQ suggestions** you can copy straight into your bot. Reports are stored in `chatlogs-dashboard.bot_reports` (one per site) and persist until regenerated. It only *recommends* — it never touches your bots (you apply the changes). Quality improves once full transcripts accumulate (see logging fix). Spec: `docs/bot-improvement-loop.md`.

### Triage workflow
`POST /api/triage` upserts per-conversation state in `chatlogs-dashboard.triage`: read/unread (auto-marked on open), starred, archived, lead status (new/contacted/closed), private notes, and manual tags. The conversations list can filter by any of these plus the AI fields. `GET /api/export?...&format=csv|json` exports the current filtered view.

### Alerts & digests (Cron)
- Every 3 min, after analysis, **real-time alerts** are raised for hot leads (lead score ≥ 70), negative/frustrated sentiment, and bot failures — de-duped via `alert_log` so each conversation alerts at most once per kind.
- `0 7 * * *` UTC sends a **daily digest**: 24h activity, lead/sentiment rollup, and silence detection (sites that went quiet), narrated by Claude.
- **Email delivery** uses Cloudflare Email Routing's `send_email` binding and is **opt-in** (see below). Until enabled, alerts/digests are still computed and recorded to `alert_log`, just not emailed.

#### Enabling email (one-time)
1. In the Cloudflare dashboard: **Email Routing** → enable it on `clydeford.net`, then add and **verify** `stevie.johnston@gmail.com` as a destination address (click the verification email).
2. Uncomment the `send_email` block in `wrangler.jsonc`:
   ```jsonc
   "send_email": [
     { "name": "SEND_EMAIL", "destination_address": "stevie.johnston@gmail.com" }
   ]
   ```
3. `npm run deploy`. The `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM` vars are already set.

(The API token used for setup lacks Email Routing scope, so this step is manual.)

### Dashboard DB schema (`chatlogs-dashboard`, migration `migrations/0001_dashboard_init.sql`)
`analysis` (AI cache) · `triage` (manual state) · `geo` (IP→location cache) · `meta` (cursors/digest bookkeeping) · `alert_log` (audit + de-dupe). Applied with `wrangler d1 execute chatlogs-dashboard --remote --file ./migrations/0001_dashboard_init.sql`.

## Source database

Bound as `DB` in `wrangler.jsonc`; **never recreated or migrated** by this project.

```
Table chat_logs (PRIMARY KEY (site, ip)) — one row = latest conversation per (site, ip)
  site TEXT · ip TEXT · created_at TEXT (ISO) · updated_at TEXT (ISO)
  request_count INTEGER · transcript TEXT (JSON: { messages: [{role,content}], cta: bool })
```

This dashboard issues `SELECT` only. No migrations, inserts, updates, or deletes
are ever run against the shared `chat-logs` database.

---

## Secrets & git hygiene

- `.env` (Cloudflare token + account id and other project secrets) is **git-ignored**.
- `ACCESS_AUD` and `ANTHROPIC_API_KEY` live as Worker secrets (`wrangler secret put …`), never in source or the client bundle.
- `.dev.vars`, `node_modules/`, `web/dist/`, and `.wrangler/` are git-ignored too.

---

## Deployment status

- ✅ Deployed: `chatlogs` Worker, custom domain `chatlogs.clydeford.net` live.
- ✅ Bindings: `DB` (D1 `chat-logs`, read-only), `DASH_DB` (D1 `chatlogs-dashboard`), `ASSETS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (secret), `ANTHROPIC_API_KEY` (secret).
- ✅ Cron Triggers active: `*/3 * * * *` (analysis + alerts), `0 7 * * *` (daily digest).
- ✅ Cloudflare Access app + owner-only policy; unauthenticated requests return 302 → Access login (verified for `/` and `/api/*`).
- ✅ AI pipeline verified end-to-end: conversations auto-analyzed, leads/sentiment/bot-failures scored, geo cached, alerts logged.
- ⏳ **Email delivery is opt-in** — enable Email Routing + verify the destination, then uncomment the `send_email` binding and redeploy (see "Enabling email" above). Until then, alerts/digests are computed and logged but not emailed.
- ⚠️ **Known data issue (write side):** chatbots using the old logging helper overwrote the transcript each turn, so historical rows store only the last exchange. `wrangler_instructions.txt` now contains an append-based helper that fixes this going forward — adopt it on each chatbot. Existing truncated rows can't be recovered.
