import type { Breakdown, DailyPoint, HeatCell } from "../types";

/** Map activity heat (0..1) to a colour: cool grey (quiet) → amber → hot orange (busy). */
export function heatColor(heat: number): [number, number, number] {
  const cool: [number, number, number] = [93, 106, 134];
  const amber: [number, number, number] = [242, 180, 90];
  const hot: [number, number, number] = [240, 121, 79];
  const lerp = (a: [number, number, number], b: [number, number, number], t: number) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
  return heat <= 0.55 ? lerp(cool, amber, heat / 0.55) : lerp(amber, hot, (heat - 0.55) / 0.45);
}

/** Tiny inline sparkline for site tiles; `color` warms with recent activity. */
export function Sparkline({
  data,
  height = 32,
  color,
}: {
  data: number[];
  height?: number;
  color?: string;
}) {
  const w = 200;
  const h = height;
  const pad = 3;
  const max = Math.max(1, ...data);
  const n = data.length;
  if (n === 0) return null;
  const x = (i: number) => pad + (n === 1 ? 0 : (i * (w - 2 * pad)) / (n - 1));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const lastV = data[n - 1];
  const total = data.reduce((a, b) => a + b, 0);
  const empty = total === 0;
  const stroke = color ?? "var(--signal)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`spark${empty ? " empty" : ""}`} preserveAspectRatio="none" role="img" aria-label="14-day activity">
      <path d={area} className="spark-area" style={empty ? undefined : { fill: stroke, fillOpacity: 0.14 }} />
      <path d={line} className="spark-line" style={empty ? undefined : { stroke }} />
      {!empty && <circle cx={x(n - 1)} cy={y(lastV)} r={2.4} className="spark-dot" style={{ fill: stroke }} />}
    </svg>
  );
}

/** Dual-line area chart for conversations + requests over time. */
export function TimeSeries({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) return <div className="chart-empty">No activity in range.</div>;
  const w = 760;
  const h = 180;
  const pad = 28;
  const maxConv = Math.max(1, ...data.map((d) => d.conversations));
  const n = data.length;
  const x = (i: number) => pad + (n === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (n - 1));
  const y = (v: number) => h - pad - (v / maxConv) * (h - 2 * pad);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.conversations)}`).join(" ");
  const area = `${line} L${x(n - 1)},${h - pad} L${x(0)},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ts-chart" preserveAspectRatio="none" role="img">
      <path d={area} className="ts-area" />
      <path d={line} className="ts-line" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.conversations)} r={2.5} className="ts-dot">
          <title>{`${d.day}: ${d.conversations} conversations, ${d.requests} requests`}</title>
        </circle>
      ))}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="ts-axis" />
      <text x={pad} y={14} className="ts-axislabel">{maxConv} max/day</text>
    </svg>
  );
}

/** Horizontal bar breakdown (intents, sentiments, geo). */
export function BarBreakdown({ data, colorClass }: { data: Breakdown[]; colorClass?: string }) {
  if (data.length === 0) return <div className="chart-empty">No data yet.</div>;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.key}>
          <span className="bar-label" title={d.key}>{d.key}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${colorClass ?? ""} ${colorClass === "sent" ? `s-${d.key}` : ""}`}
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="bar-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hour-of-day × weekday activity heatmap. */
export function Heatmap({ data }: { data: HeatCell[] }) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const c of data) {
    if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.dow][c.hour] = c.count;
      if (c.count > max) max = c.count;
    }
  }
  if (max === 0) return <div className="chart-empty">No activity yet.</div>;
  return (
    <div className="heatmap">
      <div className="heat-hours">
        <span className="heat-corner" />
        {Array.from({ length: 24 }).map((_, hr) => (
          <span key={hr} className="heat-hr">{hr % 6 === 0 ? hr : ""}</span>
        ))}
      </div>
      {grid.map((row, dow) => (
        <div className="heat-row" key={dow}>
          <span className="heat-dow">{DOW[dow]}</span>
          {row.map((v, hr) => (
            <span
              key={hr}
              className="heat-cell"
              style={{ opacity: v === 0 ? 0.06 : 0.18 + 0.82 * (v / max) }}
              title={`${DOW[dow]} ${hr}:00 — ${v} conversation${v === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Donut-ish single-stat ring for CTA conversion. */
export function RateRing({ rate, label }: { rate: number; label: string }) {
  const pct = Math.round(rate * 100);
  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 90 90" width="90" height="90">
        <circle cx="45" cy="45" r={r} className="ring-bg" />
        <circle
          cx="45"
          cy="45"
          r={r}
          className="ring-fg"
          strokeDasharray={`${(pct / 100) * circ} ${circ}`}
          transform="rotate(-90 45 45)"
        />
        <text x="45" y="50" className="ring-text">{pct}%</text>
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  );
}
