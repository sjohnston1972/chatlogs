import { useCallback, useEffect, useState } from "react";

/**
 * Minimal history-based router. The Worker's ASSETS binding is configured with
 * not_found_handling: single-page-application, so any path returns index.html
 * and this router takes over client-side.
 */
export interface Location {
  path: string;
  search: URLSearchParams;
}

function current(): Location {
  return {
    path: window.location.pathname,
    search: new URLSearchParams(window.location.search),
  };
}

export function useLocation(): Location {
  const [loc, setLoc] = useState<Location>(current);
  useEffect(() => {
    const onPop = () => setLoc(current());
    window.addEventListener("popstate", onPop);
    window.addEventListener("app:navigate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("app:navigate", onPop);
    };
  }, []);
  return loc;
}

export function navigate(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("app:navigate"));
  window.scrollTo(0, 0);
}

export function useNavigate(): (to: string) => void {
  return useCallback(navigate, []);
}

/** Build a URL with a query string from a params object. */
export function href(path: string, params?: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
