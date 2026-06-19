import { useEffect, useState } from "react";
import { api } from "../api";
import type { BotReport, Gap, SiteSummary } from "../types";
import { fmtRelative } from "../format";
import { href, navigate, useLocation } from "../router";
import { heatColor } from "./charts";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copybtn"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "✓ copied" : "Copy"}
    </button>
  );
}

const SEV_RANK: Record<string, number> = { high: 1, medium: 0.55, low: 0.25 };

function GapCard({ gap, site }: { gap: Gap; site: string }) {
  const [r, g, b] = heatColor(SEV_RANK[gap.severity] ?? 0.4);
  const c = `rgb(${r}, ${g}, ${b})`;
  return (
    <div className="gap-card" style={{ boxShadow: `inset 4px 0 0 ${c}` }}>
      <div className="gap-head">
        <span className="gap-theme">{gap.theme}</span>
        <span className="gap-sev" style={{ color: c, borderColor: c }}>{gap.severity}</span>
        <span className="gap-freq">{gap.frequency}× in sample</span>
        <span className="gap-type">{gap.fix_type.replace("_", " ")}</span>
        {gap.example_ip && (
          <a
            className="gap-example"
            href={href("/conversation", { site, ip: gap.example_ip })}
            onClick={(e) => {
              e.preventDefault();
              navigate(href("/conversation", { site, ip: gap.example_ip }));
            }}
          >
            example →
          </a>
        )}
      </div>
      <p className="gap-diagnosis">{gap.diagnosis}</p>
      <div className="fix-block">
        <div className="fix-head">
          <span className="fix-label">Suggested fix</span>
          <CopyButton text={gap.suggested_fix} />
        </div>
        <p className="fix-text">{gap.suggested_fix}</p>
      </div>
    </div>
  );
}

export function ImproveView({ sites }: { sites: SiteSummary[] | null }) {
  const loc = useLocation();
  const site = loc.search.get("site") || "";

  const [data, setData] = useState<BotReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!site) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .improveGet(site)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [site]);

  async function regenerate() {
    if (!site || running) return;
    setRunning(true);
    setError(null);
    try {
      setData(await api.improveRun(site));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const rep = data?.report;

  return (
    <div className="page">
      <h1 className="title">Improve</h1>
      <p className="subtitle">
        Turn real conversations into concrete fixes for each bot — content gaps, FAQ answers, and
        system-prompt additions. Suggestions only; you apply them to your bot.
      </p>

      <div className="filters">
        <div className="field grow">
          <label htmlFor="imp-site">Site</label>
          <select id="imp-site" value={site} onChange={(e) => navigate(href("/improve", { site: e.target.value }))}>
            <option value="">Select a site…</option>
            {sites?.map((s) => (
              <option key={s.site} value={s.site}>{s.site}</option>
            ))}
          </select>
        </div>
        {site && (
          <button className="btn primary" onClick={regenerate} disabled={running}>
            {running ? "Analysing… (10-30s)" : data?.generated_at ? "Regenerate" : "Generate report"}
          </button>
        )}
      </div>

      {!site && <div className="state">Pick a site to see how to improve its bot.</div>}
      {error && <div className="state error">{error}</div>}
      {site && loading && <div className="state">loading…</div>}

      {site && !loading && data && !rep && !running && (
        <div className="state">No report yet — click “Generate report” to analyse {site}.</div>
      )}

      {rep && (
        <>
          <div className="health-head">
            <div className="health-score">
              <div
                className="health-n"
                style={{ color: `rgb(${heatColor((data!.health_score ?? 0) / 100).join(",")})` }}
              >
                {data!.health_score}
              </div>
              <div className="health-k">bot health</div>
            </div>
            <div className="health-facts">
              <Fact k="failure rate" v={`${Math.round((data!.failure_rate ?? 0) * 100)}%`} />
              <Fact k="conversations" v={`${data!.conversations_analyzed} (last ${data!.window_days}d)`} />
              <Fact k="generated" v={data!.generated_at ? fmtRelative(data!.generated_at) : "—"} />
              <Fact k="model" v={data!.model ?? "—"} />
            </div>
          </div>

          <p className="report-headline">{rep.headline}</p>

          {rep.gaps.length > 0 ? (
            <>
              <h2 className="section-h">Content gaps ({rep.gaps.length})</h2>
              <div className="gaps">
                {rep.gaps.map((gp, i) => (
                  <GapCard key={i} gap={gp} site={site} />
                ))}
              </div>
            </>
          ) : (
            <div className="state">No significant gaps found in the sample — this bot is doing well.</div>
          )}

          {rep.system_prompt_additions.length > 0 && (
            <>
              <h2 className="section-h">Suggested system-prompt additions</h2>
              <div className="paste-block">
                <div className="fix-head">
                  <span className="fix-label">Paste into your bot's system prompt</span>
                  <CopyButton text={rep.system_prompt_additions.join("\n")} />
                </div>
                <pre className="paste-pre">{rep.system_prompt_additions.map((l) => `• ${l}`).join("\n")}</pre>
              </div>
            </>
          )}

          {rep.faq_suggestions.length > 0 && (
            <>
              <h2 className="section-h">Suggested FAQ entries</h2>
              <div className="faqs">
                {rep.faq_suggestions.map((f, i) => (
                  <div className="faq-item" key={i}>
                    <div className="fix-head">
                      <span className="faq-q">Q: {f.q}</span>
                      <CopyButton text={`Q: ${f.q}\nA: ${f.a}`} />
                    </div>
                    <p className="faq-a">A: {f.a}</p>
                  </div>
                ))}
              </div>
            </>
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
