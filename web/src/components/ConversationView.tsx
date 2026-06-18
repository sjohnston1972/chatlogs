import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ConversationDetail, TriageState } from "../types";
import { fmtAbsolute, fmtNum, fmtRelative } from "../format";
import { href, navigate, useLocation } from "../router";
import { IntentBadge, LeadBadge, SentimentDot } from "./badges";

const LEAD_STATUSES = ["", "new", "contacted", "closed"];

export function ConversationView() {
  const loc = useLocation();
  const site = loc.search.get("site") || "";
  const ip = loc.search.get("ip") || "";

  const [data, setData] = useState<ConversationDetail | null>(null);
  const [triage, setTriage] = useState<TriageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const noteSaved = useRef("");

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
        if (!alive) return;
        setData(d);
        setTriage(d.triage);
        setNote(d.triage.note ?? "");
        noteSaved.current = d.triage.note ?? "";
        setLoading(false);
        // Auto mark-as-read on open.
        if (!d.triage.is_read) {
          api.triage(site, ip, { is_read: true }).then((r) => alive && setTriage(r.triage)).catch(() => {});
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

  async function patch(p: Partial<TriageState>) {
    const r = await api.triage(site, ip, p);
    setTriage(r.triage);
  }

  function saveNote() {
    if (note === noteSaved.current) return;
    noteSaved.current = note;
    patch({ note });
  }

  const a = data?.analysis;

  return (
    <div className="page">
      <div className="crumbs">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>sites</a>
        <span className="sep">/</span>
        <a href={href("/conversations", { site })} onClick={(e) => { e.preventDefault(); navigate(href("/conversations", { site })); }}>{site || "conversations"}</a>
        <span className="sep">/</span>
        <span className="mono">{ip}</span>
      </div>

      {loading && <div className="state">loading transcript…</div>}
      {error && <div className="state error">{error}</div>}

      {data && triage && (
        <>
          <div className="detail-head">
            <div className="top">
              <span className="ipsite">{data.ip}</span>
              <span className="badge">{data.site}</span>
              {data.geo?.country && <span className="badge">{data.geo.city ? `${data.geo.city}, ` : ""}{data.geo.country}</span>}
              {data.cta && <span className="badge cta">cta triggered</span>}
              <div className="triage-controls">
                <button className={`tbtn${triage.starred ? " on" : ""}`} onClick={() => patch({ starred: !triage.starred })}>★ {triage.starred ? "Starred" : "Star"}</button>
                <button className={`tbtn${triage.archived ? " on" : ""}`} onClick={() => patch({ archived: !triage.archived })}>{triage.archived ? "Archived" : "Archive"}</button>
                <button className="tbtn" onClick={() => patch({ is_read: !triage.is_read })}>{triage.is_read ? "Mark unread" : "Mark read"}</button>
                <select className="tsel" value={triage.lead_status ?? ""} onChange={(e) => patch({ lead_status: e.target.value || null })} title="lead status">
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s ? `lead: ${s}` : "lead: —"}</option>)}
                </select>
              </div>
            </div>

            <div className="metafacts">
              <Fact k="requests" v={fmtNum(data.request_count)} />
              <Fact k="messages" v={fmtNum(data.messages.length)} />
              <Fact k="first seen" v={fmtAbsolute(data.created_at)} />
              <Fact k="last update" v={`${fmtAbsolute(data.updated_at)} · ${fmtRelative(data.updated_at)}`} />
              {data.geo?.org && <Fact k="network" v={data.geo.org} />}
            </div>
          </div>

          {a ? (
            <div className="ai-panel">
              <div className="ai-panel-head">
                <span className="ai-label">AI analysis</span>
                <IntentBadge intent={a.intent} />
                <span className="sent-inline"><SentimentDot sentiment={a.sentiment} /> {a.sentiment}</span>
                <LeadBadge score={a.lead_score} isLead={a.is_lead} />
                {a.bot_failed && <span className="failbadge">bot failed</span>}
              </div>
              <p className="ai-summary">{a.summary}</p>
              {a.topics.length > 0 && (
                <div className="topics">
                  {a.topics.map((t) => <span key={t} className="topic">{t}</span>)}
                </div>
              )}
              {a.model && <div className="ai-meta">analyzed by {a.model}{a.analyzed_at ? ` · ${fmtRelative(a.analyzed_at)}` : ""}</div>}
            </div>
          ) : (
            <div className="ai-panel pending">AI analysis pending — it runs automatically and will appear shortly.</div>
          )}

          <div className="note-block">
            <label className="note-label">Private note</label>
            <textarea className="note-input" placeholder="Notes for this visitor (saved automatically)…" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} rows={2} />
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
