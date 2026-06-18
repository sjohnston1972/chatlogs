import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ConversationListResult, SiteSummary } from "../types";
import { fmtNum, fmtRelative, isRecent } from "../format";
import { href, navigate, useLocation } from "../router";

const PAGE_SIZE = 50;

export function ConversationsView({ sites }: { sites: SiteSummary[] | null }) {
  const loc = useLocation();
  const site = loc.search.get("site") || "";
  const q = loc.search.get("q") || "";
  const from = loc.search.get("from") || "";
  const to = loc.search.get("to") || "";
  const sort = loc.search.get("sort") || "updated_at";
  const dir = loc.search.get("dir") || "desc";
  const page = Math.max(1, parseInt(loc.search.get("page") || "1", 10) || 1);

  const [data, setData] = useState<ConversationListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Local form state for text inputs (applied on submit).
  const [qInput, setQInput] = useState(q);
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => setFromInput(from), [from]);
  useEffect(() => setToInput(to), [to]);

  const params = useMemo(
    () => ({ site, q, from, to, sort, dir, page, pageSize: PAGE_SIZE }),
    [site, q, from, to, sort, dir, page],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
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
  }, [params]);

  function update(next: Record<string, string | number | undefined>) {
    const merged = { site, q, from, to, sort, dir, page, ...next };
    // Any filter change resets to page 1 unless page is explicitly set.
    if (!("page" in next)) merged.page = 1;
    navigate(href("/conversations", merged));
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    // Expand bare YYYY-MM-DD inputs to full-day ISO bounds so the `to` day is inclusive.
    const fromIso = fromInput ? `${fromInput.slice(0, 10)}T00:00:00.000Z` : "";
    const toIso = toInput ? `${toInput.slice(0, 10)}T23:59:59.999Z` : "";
    update({ q: qInput.trim(), from: fromIso, to: toIso });
  }

  function toggleSort(col: string) {
    if (sort === col) {
      update({ sort: col, dir: dir === "desc" ? "asc" : "desc" });
    } else {
      update({ sort: col, dir: "desc" });
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const arrow = (col: string) => (sort === col ? (dir === "desc" ? " ↓" : " ↑") : "");

  return (
    <div className="page">
      <div className="crumbs">
        <a href="/" onClick={navLink("/")}>
          sites
        </a>
        <span className="sep">/</span>
        <span>conversations{site ? ` · ${site}` : ""}</span>
      </div>

      <h1 className="title">Conversations</h1>
      <p className="subtitle">
        {site ? `Filtered to ${site}. ` : "All sites. "}
        Newest activity first by default.
      </p>

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="f-site">Site</label>
          <select
            id="f-site"
            value={site}
            onChange={(e) => update({ site: e.target.value })}
          >
            <option value="">All sites</option>
            {sites?.map((s) => (
              <option key={s.site} value={s.site}>
                {s.site}
              </option>
            ))}
          </select>
        </div>

        <div className="field grow">
          <label htmlFor="f-q">Search transcript</label>
          <input
            id="f-q"
            className="mono"
            placeholder="text in any message…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="f-from">Updated from</label>
          <input
            id="f-from"
            type="date"
            className="mono"
            value={fromInput.slice(0, 10)}
            onChange={(e) => setFromInput(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="f-to">Updated to</label>
          <input
            id="f-to"
            type="date"
            className="mono"
            value={toInput.slice(0, 10)}
            onChange={(e) => setToInput(e.target.value)}
          />
        </div>

        <button type="submit" className="btn primary">
          Apply
        </button>
        {(q || from || to || site) && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate("/conversations")}
          >
            Clear
          </button>
        )}
      </form>

      {error && <div className="state error">{error}</div>}

      {!error && (
        <>
          <div className="tablewrap">
            <div className="row head">
              <span className="h">Site</span>
              <span className="h">Visitor IP</span>
              <span className="h">Preview · first message</span>
              <span
                className="h sortable"
                style={{ textAlign: "right" }}
                onClick={() => toggleSort("request_count")}
              >
                Reqs{arrow("request_count")}
              </span>
              <span
                className="h sortable"
                style={{ textAlign: "right" }}
                onClick={() => toggleSort("updated_at")}
              >
                Updated{arrow("updated_at")}
              </span>
            </div>

            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <div className="row" key={i} style={{ cursor: "default" }}>
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14 }} />
                </div>
              ))}

            {!loading && data && data.items.length === 0 && (
              <div className="state" style={{ border: "none" }}>
                No conversations match these filters.
              </div>
            )}

            {!loading &&
              data?.items.map((c) => (
                <div
                  className="row"
                  key={`${c.site}|${c.ip}`}
                  onClick={() => navigate(href("/conversation", { site: c.site, ip: c.ip }))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    navigate(href("/conversation", { site: c.site, ip: c.ip }))
                  }
                >
                  <span className="cell-site">{c.site}</span>
                  <span className="cell-ip">{c.ip}</span>
                  <span className="cell-preview">
                    {c.cta && <span className="badge cta">cta</span>}
                    {c.preview ? c.preview : <span className="empty">no user message</span>}
                  </span>
                  <span className="cell-count">{fmtNum(c.request_count)}</span>
                  <span className="cell-time">
                    <span className={isRecent(c.updated_at, 24) ? "live" : ""}>
                      {fmtRelative(c.updated_at)}
                    </span>
                  </span>
                </div>
              ))}
          </div>

          <div className="pager">
            <span>
              {total === 0
                ? "0 results"
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${fmtNum(total)}`}
            </span>
            <div className="ctrls">
              <button
                className="btn"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                ← Prev
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                className="btn"
                disabled={page >= totalPages}
                onClick={() => update({ page: page + 1 })}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Intercept anchor clicks for client-side navigation. */
function navLink(to: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };
}
