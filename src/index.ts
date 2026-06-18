import type { Env } from "./types";
import { verifyAccess } from "./access";
import {
  getActivity,
  getConversation,
  getConversations,
  getSites,
} from "./db";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  // Defense-in-depth: verify the Access JWT when ACCESS_AUD is configured.
  const auth = await verifyAccess(request, env);
  if (!auth.ok) {
    return json({ error: "unauthorized", reason: auth.reason }, 401);
  }

  const path = url.pathname;
  const q = url.searchParams;

  try {
    // GET /api/sites — landing summary
    if (path === "/api/sites" && request.method === "GET") {
      const sites = await getSites(env.DB);
      return json({ sites });
    }

    // GET /api/activity?site= — last 24h / 7d counts
    if (path === "/api/activity" && request.method === "GET") {
      const stats = await getActivity(env.DB, q.get("site"));
      return json(stats);
    }

    // GET /api/conversations?site=&q=&from=&to=&sort=&dir=&page=&pageSize=
    if (path === "/api/conversations" && request.method === "GET") {
      const pageSize = clampInt(q.get("pageSize"), 50, 1, 200);
      const page = clampInt(q.get("page"), 1, 1, 1_000_000);
      const result = await getConversations(env.DB, {
        site: q.get("site"),
        q: q.get("q"),
        from: q.get("from"),
        to: q.get("to"),
        sort: q.get("sort"),
        dir: q.get("dir"),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return json({ ...result, page, pageSize });
    }

    // GET /api/conversation?site=&ip= — full transcript
    if (path === "/api/conversation" && request.method === "GET") {
      const site = q.get("site");
      const ip = q.get("ip");
      if (!site || !ip) {
        return json({ error: "site and ip are required" }, 400);
      }
      const detail = await getConversation(env.DB, site, ip);
      if (!detail) return json({ error: "not found" }, 404);
      return json(detail);
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return json({ error: "query failed", detail: message }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    // Everything else: serve the React SPA from the ASSETS binding.
    // not_found_handling: single-page-application returns index.html for
    // unknown client-side routes.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
