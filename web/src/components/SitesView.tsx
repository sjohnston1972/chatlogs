import { useEffect, useState } from "react";
import { api } from "../api";
import type { SiteSummary } from "../types";
import { fmtNum, fmtRelative, isRecent } from "../format";
import { href, navigate } from "../router";
import { Sparkline, heatColor } from "./charts";

/** Recent activity = conversations active in the last ~3 days (last 12 of the 6h buckets). */
function recent3(spark: number[] | undefined): number {
  return (spark ?? []).slice(-12).reduce((a, b) => a + b, 0);
}

/** Ranking score blending busyness (recent volume) with last-activity recency. */
function sortScore(s: { spark?: number[]; last_activity: string | null }): number {
  const busy = recent3(s.spark);
  const last = s.last_activity ? new Date(s.last_activity).getTime() : 0;
  const hoursSince = last ? (Date.now() - last) / 3_600_000 : 1e9;
  const recency = Math.max(0, (72 - hoursSince) / 72); // 1 = just now, 0 = ≥3 days ago
  return busy + recency * 3; // recency nudges up to +3 conversations-equivalent
}

export function SitesView() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .sites()
      .then((r) => alive && setSites(r.sites))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <h1 className="title">Sites</h1>
      <p className="subtitle">
        Every chatbot writing to the shared log. Select a site to read its conversations.
      </p>

      {error && <div className="state error">{error}</div>}

      {!sites && !error && (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card">
              <div className="skeleton" style={{ height: 18, width: "70%" }} />
              <div className="skeleton" style={{ height: 40, marginTop: 18 }} />
            </div>
          ))}
        </div>
      )}

      {sites && sites.length === 0 && (
        <div className="state">No conversations logged yet. Sites appear here as chatbots write rows.</div>
      )}

      {sites && sites.length > 0 && (
        <div className="grid">
          {[...sites]
            .sort((a, b) => sortScore(b) - sortScore(a) || b.conversations - a.conversations)
            .map((s) => {
            const spark = s.spark ?? [];
            const total14 = spark.reduce((a, b) => a + b, 0);
            const active24 = isRecent(s.last_activity, 24);
            let heat = total14 === 0 ? 0 : Math.min(1, recent3(spark) / 4);
            if (active24) heat = Math.max(heat, 0.55);
            const [r, g, b] = heatColor(heat);
            const stroke = `rgb(${r}, ${g}, ${b})`;
            const glow =
              heat > 0
                ? `0 0 ${Math.round(8 + heat * 28)}px rgba(${r}, ${g}, ${b}, ${(0.1 + heat * 0.34).toFixed(2)})`
                : undefined;
            return (
              <button
                key={s.site}
                className="card"
                style={{ boxShadow: glow }}
                onClick={() => navigate(href("/conversations", { site: s.site }))}
              >
                <div className="site">{s.site}</div>
                <div className="metarow">
                  <div className="metric">
                    <div className="n">{fmtNum(s.conversations)}</div>
                    <div className="k">conversations</div>
                  </div>
                  <div className="metric">
                    <div className="n">{fmtNum(s.requests)}</div>
                    <div className="k">requests</div>
                  </div>
                </div>
                {s.spark && (
                  <div className="spark-wrap">
                    <Sparkline data={s.spark} color={stroke} />
                    <span className="spark-cap">14-day activity · 6h resolution</span>
                  </div>
                )}
                <div className="last">
                  <span>last activity {fmtRelative(s.last_activity)}</span>
                  {active24 && <span className="pulse" title="active in last 24h" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
