import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ConversationFilters } from "../api";
import type { ConversationListResult, SiteSummary } from "../types";
import { fmtNum, fmtRelative, flagEmoji, isRecent } from "../format";
import { href, navigate, useLocation } from "../router";
import { AiMarkers } from "./badges";

const PAGE_SIZE = 50;
const INTENTS = ["pricing", "support", "booking", "lead", "complaint", "smalltalk", "other"];
const SENTIMENTS = ["positive", "neutral", "negative", "frustrated"];

export function ConversationsView({ sites }: { sites: SiteSummary[] | null }) {
  const loc = useLocation();
  const g = (k: string) => loc.search.get(k) || "";
  const site = g("site");
  const q = g("q");
  const from = g("from");
  const to = g("to");
  const sort = g("sort") || "updated_at";
  const dir = g("dir") || "desc";
  const intent = g("intent");
  const sentiment = g("sentiment");
  const lead = g("lead") === "1";
  const failed = g("failed") === "1";
  const starred = g("starred") === "1";
  const unread = g("read") === "0";
  const archived = g("archived") === "1";
  const live = g("live") === "1";
  const page = Math.max(1, parseInt(g("page") || "1", 10) || 1);

  const [data, setData] = useState<ConversationListResult & { keysCapped?: boolean }>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(0);

  const [qInput, setQInput] = useState(q);
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => setFromInput(from), [from]);
  useEffect(() => setToInput(to), [to]);

  const params: ConversationFilters = useMemo(
    () => ({
      site, q, from, to, sort, dir, page, pageSize: PAGE_SIZE,
      intent: intent || undefined,
      sentiment: sentiment || undefined,
      lead: lead || undefined,
      failed: failed || undefined,
      starred: starred || undefined,
      archived: archived || undefined,
      read: unread ? false : undefined,
    }),
    [site, q, from, to, sort, dir, page, intent, sentiment, lead, failed, starred, unread, archived],
  );

  const load = useCallback(
    (showLoading: boolean) => {
      let alive = true;
      if (showLoading) setLoading(true);
      api
        .conversations(params)
        .then((r) => {
          if (alive) {
            setData(r);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e.message);
            setLoading(false);
          }
        });
      return () => {
        alive = false;
      };
    },
    [params],
  );

  useEffect(() => {
    setError(null);
    return load(true);
  }, [load]);

  // Live mode: poll every 15s without the loading flash.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => load(false), 15000);
    return () => clearInterval(id);
  }, [live, load]);

  function update(next: Record<string, string | number | undefined>) {
    const cur: Record<string, string | number | undefined> = {
      site, q, from, to, sort, dir, page, intent, sentiment,
      lead: lead ? 1 : undefined,
      failed: failed ? 1 : undefined,
      starred: starred ? 1 : undefined,
      read: unread ? 0 : undefined,
      archived: archived ? 1 : undefined,
      live: live ? 1 : undefined,
    };
    const merged = { ...cur, ...next };
    if (!("page" in next)) merged.page = 1;
    navigate(href("/conversations", merged));
  }

  function toggle(key: string, on: boolean, val: string | number = 1) {
    update({ [key]: on ? val : undefined });
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    update({
      q: qInput.trim(),
      from: fromInput ? `${fromInput.slice(0, 10)}T00:00:00.000Z` : undefined,
      to: toInput ? `${toInput.slice(0, 10)}T23:59:59.999Z` : undefined,
    });
  }

  async function toggleStar(e: React.MouseEvent, s: string, ip: string, cur: boolean) {
    e.stopPropagation();
    await api.triage(s, ip, { starred: !cur });
    load(false);
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Keyboard navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "j") {
        setSel((s) => Math.min(items.length - 1, s + 1));
      } else if (e.key === "k") {
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter" && items[sel]) {
        navigate(href("/conversation", { site: items[sel].site, ip: items[sel].ip }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sel]);

  const arrow = (col: string) => (sort === col ? (dir === "desc" ? " ↓" : " ↑") : "");
  const anyFilter = q || from || to || site || intent || sentiment || lead || failed || starred || unread || archived;

  return (
    <div className="page">
      <div className="crumbs">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>sites</a>
        <span className="sep">/</span>
        <span>conversations{site ? ` · ${site}` : ""}</span>
      </div>

      <div className="title-row">
        <h1 className="title">Conversations</h1>
        <div className="title-actions">
          <button className={`btn small${live ? " primary" : ""}`} onClick={() => toggle("live", !live)} title="auto-refresh every 15s">
            {live ? "● Live" : "○ Live"}
          </button>
          <a className="btn small" href={api.exportUrl({ ...params, format: "csv" })}>Export CSV</a>
          <a className="btn small" href={api.exportUrl({ ...params, format: "json" })}>JSON</a>
        </div>
      </div>
      <p className="subtitle">AI summary &amp; signals per conversation. Keys: <span className="kbd">j</span>/<span className="kbd">k</span> move · <span className="kbd">↵</span> open · <span className="kbd">/</span> search.</p>

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="f-site">Site</label>
          <select id="f-site" value={site} onChange={(e) => update({ site: e.target.value })}>
            <option value="">All sites</option>
            {sites?.map((s) => <option key={s.site} value={s.site}>{s.site}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="f-q">Search transcript</label>
          <input id="f-q" ref={searchRef} className="mono" placeholder="text in any message…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-intent">Intent</label>
          <select id="f-intent" value={intent} onChange={(e) => update({ intent: e.target.value || undefined })}>
            <option value="">Any</option>
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-sent">Sentiment</label>
          <select id="f-sent" value={sentiment} onChange={(e) => update({ sentiment: e.target.value || undefined })}>
            <option value="">Any</option>
            {SENTIMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input id="f-from" type="date" className="mono" value={fromInput.slice(0, 10)} onChange={(e) => setFromInput(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input id="f-to" type="date" className="mono" value={toInput.slice(0, 10)} onChange={(e) => setToInput(e.target.value)} />
        </div>
        <button type="submit" className="btn primary">Apply</button>
      </form>

      <div className="chips">
        <Chip label="🔥 Leads" on={lead} onClick={() => toggle("lead", !lead)} />
        <Chip label="⚠ Negative" on={sentiment === "negative" || sentiment === "frustrated"} onClick={() => update({ sentiment: sentiment === "negative" ? undefined : "negative" })} />
        <Chip label="🤖 Bot-fail" on={failed} onClick={() => toggle("failed", !failed)} />
        <Chip label="★ Starred" on={starred} onClick={() => toggle("starred", !starred)} />
        <Chip label="● Unread" on={unread} onClick={() => toggle("read", !unread, 0)} />
        <Chip label="Archived" on={archived} onClick={() => toggle("archived", !archived)} />
        {anyFilter && <button className="chip clear" onClick={() => navigate("/conversations")}>clear all</button>}
      </div>

      {data?.keysCapped && <div className="notice">Showing the first 1000 matches for these filters — narrow further for complete results.</div>}
      {error && <div className="state error">{error}</div>}

      {!error && (
        <>
          <div className="tablewrap">
            <div className="row ai head">
              <span className="h">Site</span>
              <span className="h">Visitor</span>
              <span className="h">AI summary &amp; signals</span>
              <span className="h r sortable" onClick={() => update({ sort: "request_count", dir: sort === "request_count" && dir === "desc" ? "asc" : "desc" })}>Reqs{arrow("request_count")}</span>
              <span className="h r sortable" onClick={() => update({ sort: "updated_at", dir: sort === "updated_at" && dir === "desc" ? "asc" : "desc" })}>Updated{arrow("updated_at")}</span>
            </div>

            {loading && Array.from({ length: 8 }).map((_, i) => (
              <div className="row ai" key={i} style={{ cursor: "default" }}>
                {Array.from({ length: 5 }).map((__, j) => <div key={j} className="skeleton" style={{ height: 14 }} />)}
              </div>
            ))}

            {!loading && items.length === 0 && <div className="state" style={{ border: "none" }}>No conversations match these filters.</div>}

            {!loading && items.map((c, i) => {
              const x = c as typeof c & { analysis: import("../types").AnalysisSummary | null; triage: import("../types").TriageState; geo: import("../types").GeoInfo | null };
              return (
                <div
                  className={`row ai${i === sel ? " sel" : ""}${x.triage?.is_read ? "" : " unread"}`}
                  key={`${c.site}|${c.ip}`}
                  onClick={() => navigate(href("/conversation", { site: c.site, ip: c.ip }))}
                  onMouseEnter={() => setSel(i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && navigate(href("/conversation", { site: c.site, ip: c.ip }))}
                >
                  <span className="cell-site">
                    <button className={`star${x.triage?.starred ? " on" : ""}`} onClick={(e) => toggleStar(e, c.site, c.ip, x.triage?.starred)} title="star">★</button>
                    <span className="site-name" title={c.site}>{c.site}</span>
                  </span>
                  <span className="cell-ip">
                    {x.geo?.country_code && (
                      <span className="flag" title={x.geo.country ?? x.geo.country_code}>{flagEmoji(x.geo.country_code)}</span>
                    )}
                    <span className="ip-text">{c.ip}</span>
                  </span>
                  <span className="cell-preview">
                    {c.cta && <span className="badge cta">cta</span>}
                    <AiMarkers a={x.analysis} />
                    <span className="summary-text">{x.analysis?.summary || c.preview || <span className="empty">no user message</span>}</span>
                  </span>
                  <span className="cell-count">{fmtNum(c.request_count)}</span>
                  <span className="cell-time"><span className={isRecent(c.updated_at, 24) ? "live" : ""}>{fmtRelative(c.updated_at)}</span></span>
                </div>
              );
            })}
          </div>

          <div className="pager">
            <span>{total === 0 ? "0 results" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${fmtNum(total)}`}</span>
            <div className="ctrls">
              <button className="btn" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>← Prev</button>
              <span>{page} / {totalPages}</span>
              <button className="btn" disabled={page >= totalPages} onClick={() => update({ page: page + 1 })}>Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button className={`chip${on ? " on" : ""}`} onClick={onClick}>{label}</button>;
}
