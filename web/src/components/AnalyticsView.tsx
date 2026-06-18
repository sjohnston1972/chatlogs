import { useEffect, useState } from "react";
import { api } from "../api";
import type { Analytics, SiteSummary } from "../types";
import { fmtNum } from "../format";
import { BarBreakdown, Heatmap, RateRing, TimeSeries, heatColor } from "./charts";
import { href, navigate, useLocation } from "../router";

const RANGES = [7, 30, 90];

export function AnalyticsView({ sites }: { sites: SiteSummary[] | null }) {
  const loc = useLocation();
  const site = loc.search.get("site") || "";
  const days = parseInt(loc.search.get("days") || "30", 10) || 30;

  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .analytics(site || undefined, days)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [site, days]);

  function update(next: Record<string, string | number | undefined>) {
    navigate(href("/analytics", { site, days, ...next }));
  }

  return (
    <div className="page">
      <h1 className="title">Analytics</h1>
      <p className="subtitle">{site ? `Scoped to ${site}.` : "Across all sites."} Last {days} days for time-series.</p>

      <div className="filters">
        <div className="field">
          <label htmlFor="a-site">Site</label>
          <select id="a-site" value={site} onChange={(e) => update({ site: e.target.value })}>
            <option value="">All sites</option>
            {sites?.map((s) => (
              <option key={s.site} value={s.site}>{s.site}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Range</label>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} className={`segbtn${days === r ? " active" : ""}`} onClick={() => update({ days: r })}>
                {r}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="state error">{error}</div>}
      {!data && !error && <div className="state">crunching numbers…</div>}

      {data && (
        <>
          <div className="kpis">
            <Kpi n={fmtNum(data.cta.conversations)} k="conversations" />
            <Kpi n={fmtNum(data.leads.leads)} k="leads identified" accent />
            <Kpi n={fmtNum(data.leads.bot_failures)} k="bot failures" warn={data.leads.bot_failures > 0} />
            <Kpi n={`${data.leads.avg_lead_score}`} k="avg lead score" />
          </div>

          <div className="analytics-grid">
            <section className="panel wide">
              <h2 className="panel-title">Conversations over time</h2>
              <TimeSeries data={data.series} />
            </section>

            <section className="panel">
              <h2 className="panel-title">CTA conversion</h2>
              <div className="cta-block">
                <RateRing rate={data.cta.rate} label="of conversations" />
                <div className="cta-meta">
                  <div><b className="mono">{fmtNum(data.cta.cta)}</b> CTA triggered</div>
                  <div><b className="mono">{fmtNum(data.cta.conversations)}</b> total</div>
                </div>
              </div>
            </section>

            <section className="panel">
              <h2 className="panel-title">Intent</h2>
              <BarBreakdown data={data.intents} colorClass="intent" />
            </section>

            <section className="panel">
              <h2 className="panel-title">Sentiment</h2>
              <BarBreakdown data={data.sentiments} colorClass="sent" />
            </section>

            <section className="panel">
              <h2 className="panel-title">Visitors by country</h2>
              <BarBreakdown data={data.geo} colorClass="geo" />
            </section>

            <section className="panel wide">
              <h2 className="panel-title">Activity heatmap · hour × weekday (UTC)</h2>
              <Heatmap data={data.heat} />
            </section>

            <section className="panel wide">
              <h2 className="panel-title">Per-site scorecards</h2>
              <div className="tablewrap">
                <div className="srow head">
                  <span className="h">Site</span>
                  <span className="h r">Convos</span>
                  <span className="h r">Requests</span>
                  <span className="h r">Avg msgs</span>
                  <span className="h r">CTA rate</span>
                </div>
                {(() => {
                  const maxConv = Math.max(1, ...data.scores.map((s) => s.conversations));
                  return data.scores.map((s) => {
                    const heat = Math.min(1, Math.sqrt(s.conversations / maxConv));
                    const [r, g, b] = heatColor(heat);
                    const c = `rgb(${r}, ${g}, ${b})`;
                    return (
                      <div
                        className="srow"
                        key={s.site}
                        style={{ boxShadow: `inset 3px 0 0 ${c}` }}
                        onClick={() => navigate(href("/conversations", { site: s.site }))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && navigate(href("/conversations", { site: s.site }))}
                      >
                        <span className="cell-site">{s.site}</span>
                        <span className="cell-count" style={{ color: c }}>{fmtNum(s.conversations)}</span>
                        <span className="cell-count">{fmtNum(s.requests)}</span>
                        <span className="cell-count">{s.avg_messages}</span>
                        <span className="cell-count">{Math.round(s.cta_rate * 100)}%</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ n, k, accent, warn }: { n: string; k: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`kpi${accent ? " accent" : ""}${warn ? " warn" : ""}`}>
      <div className="kpi-n mono">{n}</div>
      <div className="kpi-k">{k}</div>
    </div>
  );
}
