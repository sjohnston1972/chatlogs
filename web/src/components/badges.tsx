import type { AnalysisSummary } from "../types";
import { heatColor } from "./charts";

export function SentimentDot({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  return <span className={`sdot s-${sentiment}`} title={`sentiment: ${sentiment}`} />;
}

export function IntentBadge({ intent }: { intent?: string }) {
  if (!intent) return null;
  return <span className={`ibadge i-${intent}`}>{intent}</span>;
}

export function LeadBadge({ score, isLead }: { score?: number; isLead?: boolean }) {
  if (score === undefined) return null;
  const [r, g, b] = heatColor(score / 100);
  const c = `rgb(${r}, ${g}, ${b})`;
  const hot = (isLead ?? false) && score >= 70;
  return (
    <span
      className={`leadbadge${hot ? " hot" : ""}`}
      style={{ color: c, borderColor: c }}
      title="lead score (0-100) — warmer = hotter lead"
    >
      ★ {score}
    </span>
  );
}

/** Compact inline AI markers for the conversations list. */
export function AiMarkers({ a }: { a: AnalysisSummary | null }) {
  if (!a) return <span className="ai-pending" title="not yet analyzed">·</span>;
  return (
    <span className="ai-markers">
      <SentimentDot sentiment={a.sentiment} />
      <IntentBadge intent={a.intent} />
      <LeadBadge score={a.lead_score} isLead={a.is_lead} />
      {a.bot_failed && <span className="failbadge" title="assistant failed to help">bot-fail</span>}
    </span>
  );
}
