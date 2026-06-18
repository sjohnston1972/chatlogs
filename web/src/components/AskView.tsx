import { useState } from "react";
import { api } from "../api";
import type { AskResult } from "../types";

interface Turn {
  q: string;
  result?: AskResult;
  error?: string;
  pending?: boolean;
}

const EXAMPLES = [
  "How many conversations mentioned pricing this week?",
  "Which site has the most conversations?",
  "What are visitors most frequently asking about?",
  "Show conversations from the last 24 hours by site.",
];

export function AskView() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setTurns((t) => [...t, { q, pending: true }]);
    try {
      const result = await api.ask(q);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { q, result } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { q, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="title">Ask your logs</h1>
      <p className="subtitle">
        Ask in plain English. Claude queries the conversation database (read-only) and answers with real numbers.
      </p>

      {turns.length === 0 && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="example" onClick={() => ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="ask-thread">
        {turns.map((t, i) => (
          <div className="ask-turn" key={i}>
            <div className="ask-q">{t.q}</div>
            {t.pending && <div className="ask-a pending">thinking & querying…</div>}
            {t.error && <div className="ask-a err">{t.error}</div>}
            {t.result && (
              <div className="ask-a">
                <div className="ask-answer">{t.result.answer}</div>
                {t.result.queries.length > 0 && (
                  <details className="ask-sql">
                    <summary>{t.result.queries.length} SQL quer{t.result.queries.length === 1 ? "y" : "ies"} run</summary>
                    {t.result.queries.map((sql, j) => (
                      <pre key={j} className="sql">{sql}</pre>
                    ))}
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          className="ask-input"
          placeholder="Ask about your conversations…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <button className="btn primary" type="submit" disabled={busy || input.trim().length < 3}>
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
