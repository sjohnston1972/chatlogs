import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SitesView } from "./components/SitesView";
import { ConversationsView } from "./components/ConversationsView";
import { ConversationView } from "./components/ConversationView";
import { AnalyticsView } from "./components/AnalyticsView";
import { AskView } from "./components/AskView";
import { ImproveView } from "./components/ImproveView";
import { api } from "./api";
import type { SiteSummary } from "./types";
import { useLocation } from "./router";

export function App() {
  const loc = useLocation();
  const [sites, setSites] = useState<SiteSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .sites()
      .then((r) => alive && setSites(r.sites))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  let view;
  switch (loc.path) {
    case "/conversations":
      view = <ConversationsView sites={sites} />;
      break;
    case "/conversation":
      view = <ConversationView />;
      break;
    case "/analytics":
      view = <AnalyticsView sites={sites} />;
      break;
    case "/ask":
      view = <AskView />;
      break;
    case "/improve":
      view = <ImproveView sites={sites} />;
      break;
    default:
      view = <SitesView />;
  }

  return (
    <>
      <TopBar refreshKey={loc.path} />
      {view}
    </>
  );
}
