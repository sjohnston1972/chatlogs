import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SitesView } from "./components/SitesView";
import { ConversationsView } from "./components/ConversationsView";
import { ConversationView } from "./components/ConversationView";
import { api } from "./api";
import type { SiteSummary } from "./types";
import { useLocation } from "./router";

export function App() {
  const loc = useLocation();
  const [sites, setSites] = useState<SiteSummary[] | null>(null);

  // Load the site list once for the filter dropdown (shared across views).
  useEffect(() => {
    let alive = true;
    api
      .sites()
      .then((r) => alive && setSites(r.sites))
      .catch(() => {
        /* views surface their own errors */
      });
    return () => {
      alive = false;
    };
  }, []);

  let view;
  if (loc.path === "/conversations") {
    view = <ConversationsView sites={sites} />;
  } else if (loc.path === "/conversation") {
    view = <ConversationView />;
  } else {
    view = <SitesView />;
  }

  return (
    <>
      <TopBar refreshKey={loc.path === "/" ? 1 : 0} />
      {view}
    </>
  );
}
