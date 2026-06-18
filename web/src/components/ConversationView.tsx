import { useEffect, useState } from "react";
import { api } from "../api";
import type { ConversationDetail } from "../types";
import { fmtAbsolute, fmtNum, fmtRelative } from "../format";
import { href, navigate, useLocation } from "../router";

export function ConversationView() {
  const loc = useLocation();
  const site = loc.search.get("site") || "";
  const ip = loc.search.get("ip") || "";

  const [data, setData] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!site || !ip) {
      setError("Missing site or ip.");
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .conversation(site, ip)
      .then((d) => {
        if (alive) {
          setData(d);
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
  }, [site, ip]);

  return (
    <div className="page">
      <div className="crumbs">
        <a href="/" onClick={navLink("/")}>
          sites
        </a>
        <span className="sep">/</span>
        <a
          href={href("/conversations", { site })}
          onClick={(e) => {
            e.preventDefault();
            navigate(href("/conversations", { site }));
          }}
        >
          {site || "conversations"}
        </a>
        <span className="sep">/</span>
        <span className="mono">{ip}</span>
      </div>

      {loading && <div className="state">loading transcript…</div>}
      {error && <div className="state error">{error}</div>}

      {data && (
        <>
          <div className="detail-head">
            <div className="top">
              <span className="ipsite">{data.ip}</span>
              <span className="badge">{data.site}</span>
              {data.cta && <span className="badge cta">cta triggered</span>}
            </div>
            <div className="metafacts">
              <Fact k="requests" v={fmtNum(data.request_count)} />
              <Fact k="messages" v={fmtNum(data.messages.length)} />
              <Fact k="first seen" v={`${fmtAbsolute(data.created_at)}`} />
              <Fact k="last update" v={`${fmtAbsolute(data.updated_at)} · ${fmtRelative(data.updated_at)}`} />
            </div>
          </div>

          {data.messages.length === 0 ? (
            <div className="state">This conversation has no messages.</div>
          ) : (
            <div className="thread">
              {data.messages.map((m, i) => {
                const role = m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "other";
                return (
                  <div className={`turn ${role}`} key={i}>
                    <div className="who">{m.role || "—"}</div>
                    <div className="bubble">{m.content}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function navLink(to: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };
}
