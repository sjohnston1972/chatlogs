import { useEffect, useState } from "react";
import { api } from "../api";
import type { ActivityStats } from "../types";
import { fmtNum } from "../format";
import { navigate, useLocation } from "../router";

const NAV = [
  { path: "/", label: "Sites" },
  { path: "/conversations", label: "Conversations" },
  { path: "/analytics", label: "Analytics" },
  { path: "/improve", label: "Improve" },
  { path: "/ask", label: "Ask" },
];

export function TopBar({ refreshKey }: { refreshKey: string }) {
  const loc = useLocation();
  const [stats, setStats] = useState<ActivityStats | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .activity()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const activePath = loc.path === "/conversation" ? "/conversations" : loc.path;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div
          className="brand"
          role="link"
          tabIndex={0}
          onClick={() => navigate("/")}
          onKeyDown={(e) => e.key === "Enter" && navigate("/")}
        >
          <span className="dot" />
          <span className="name">chatlogs</span>
          <span className="sub">console</span>
        </div>

        <nav className="topnav">
          {NAV.map((n) => (
            <button
              key={n.path}
              className={`navlink${activePath === n.path ? " active" : ""}`}
              onClick={() => navigate(n.path)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="ribbon" aria-label="activity">
          <Readout label="24h" value={stats ? fmtNum(stats.conversations_24h) : "·"} unit="convos" live={!!stats && stats.conversations_24h > 0} />
          <Readout label="7d" value={stats ? fmtNum(stats.conversations_7d) : "·"} unit="convos" live={!!stats && stats.conversations_7d > 0} />
          <Readout label="total" value={stats ? fmtNum(stats.total_conversations) : "·"} unit="convos" />
        </div>
      </div>
    </header>
  );
}

function Readout({ label, value, unit, live }: { label: string; value: string; unit: string; live?: boolean }) {
  return (
    <div className={`readout${live ? " live" : ""}`}>
      <span className="label">{label}</span>
      <span className="value">
        {value}
        <span className="unit">{unit}</span>
      </span>
    </div>
  );
}
