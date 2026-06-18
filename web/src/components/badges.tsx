import type { AnalysisSummary } from "../types";

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
  const hot = isLead && score >= 70;
  return (
    <span className={`leadbadge${hot ? " hot" : ""}`} title="lead score (0-100)">
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
      {a.is_lead && <LeadBadge score={a.lead_score} isLead={a.is_lead} />}
      {a.bot_failed && <span className="failbadge" title="assistant failed to help">bot-fail</span>}
    </span>
  );
}
