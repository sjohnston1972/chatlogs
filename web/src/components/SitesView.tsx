import { useEffect, useState } from "react";
import { api } from "../api";
import type { SiteSummary } from "../types";
import { fmtNum, fmtRelative, isRecent } from "../format";
import { href, navigate } from "../router";
import { Sparkline } from "./charts";

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
          {sites.map((s) => (
            <button
              key={s.site}
              className="card"
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
                  <Sparkline data={s.spark} />
                  <span className="spark-cap">14-day activity</span>
                </div>
              )}
              <div className="last">
                <span>last activity {fmtRelative(s.last_activity)}</span>
                {isRecent(s.last_activity, 24) && <span className="pulse" title="active in last 24h" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
