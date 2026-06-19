import type { Env } from "./types";
import { verifyAccess } from "./access";
import { getActivity, getSites, runReadonlySelect } from "./db";
import { listConversations, detailConversation } from "./list";
import { patchTriage, getBotReport } from "./dashdb";
import { generateReport } from "./improve";
import { askLogs } from "./ai";
import { analyzePending } from "./pipeline";
import { runAlerts, runDigest } from "./alerts";
import {
  ctaFunnel,
  geoBreakdown,
  heatmap,
  intentBreakdown,
  leadStats,
  sentimentBreakdown,
  siteScorecards,
  timeSeries,
} from "./analytics";
import type { KeyFilters } from "./dashdb";

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

function bool(v: string | null): boolean | undefined {
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

function filtersFromQuery(q: URLSearchParams): KeyFilters {
  return {
    site: q.get("site"),
    intent: q.get("intent"),
    sentiment: q.get("sentiment"),
    lead: bool(q.get("lead")) === true ? true : undefined,
    failed: bool(q.get("failed")) === true ? true : undefined,
    minLeadScore: q.get("minLeadScore") ? parseInt(q.get("minLeadScore")!, 10) : null,
    read: bool(q.get("read")) ?? null,
    starred: bool(q.get("starred")) === true ? true : undefined,
    archived: bool(q.get("archived")) === true ? true : undefined,
    leadStatus: q.get("leadStatus"),
  };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await verifyAccess(request, env);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const path = url.pathname;
  const q = url.searchParams;
  const method = request.method;

  try {
    if (path === "/api/sites" && method === "GET") {
      return json({ sites: await getSites(env.DB) });
    }

    if (path === "/api/activity" && method === "GET") {
      return json(await getActivity(env.DB, q.get("site")));
    }

    if (path === "/api/conversations" && method === "GET") {
      const pageSize = clampInt(q.get("pageSize"), 50, 1, 200);
      const page = clampInt(q.get("page"), 1, 1, 1_000_000);
      const result = await listConversations(
        env,
        {
          site: q.get("site"),
          q: q.get("q"),
          from: q.get("from"),
          to: q.get("to"),
          sort: q.get("sort"),
          dir: q.get("dir"),
          limit: pageSize,
          offset: (page - 1) * pageSize,
        },
        filtersFromQuery(q),
      );
      return json({ ...result, page, pageSize });
    }

    if (path === "/api/conversation" && method === "GET") {
      const site = q.get("site");
      const ip = q.get("ip");
      if (!site || !ip) return json({ error: "site and ip are required" }, 400);
      const detail = await detailConversation(env, site, ip);
      if (!detail) return json({ error: "not found" }, 404);
      return json(detail);
    }

    if (path === "/api/triage" && method === "POST") {
      const body = (await request.json()) as {
        site?: string;
        ip?: string;
        is_read?: boolean;
        starred?: boolean;
        archived?: boolean;
        lead_status?: string | null;
        note?: string | null;
        tags?: string[];
      };
      if (!body.site || !body.ip) return json({ error: "site and ip are required" }, 400);
      const { site, ip, ...patch } = body;
      const updated = await patchTriage(env.DASH_DB, site, ip, patch);
      return json({ triage: updated });
    }

    if (path === "/api/ask" && method === "POST") {
      const body = (await request.json()) as { question?: string };
      if (!body.question || body.question.trim().length < 3) {
        return json({ error: "question is required" }, 400);
      }
      if (!env.ANTHROPIC_API_KEY) return json({ error: "AI not configured" }, 503);
      const result = await askLogs(env, body.question.trim(), (sql) =>
        runReadonlySelect(env.DB, sql),
      );
      return json(result);
    }

    if (path === "/api/analytics" && method === "GET") {
      const site = q.get("site");
      const days = clampInt(q.get("days"), 30, 1, 365);
      const [series, cta, heat, scores, intents, sentiments, leads, geo] = await Promise.all([
        timeSeries(env.DB, days, site),
        ctaFunnel(env.DB, site),
        heatmap(env.DB, site),
        siteScorecards(env.DB),
        intentBreakdown(env.DASH_DB, site),
        sentimentBreakdown(env.DASH_DB, site),
        leadStats(env.DASH_DB, site),
        geoBreakdown(env.DASH_DB),
      ]);
      return json({ series, cta, heat, scores, intents, sentiments, leads, geo, days });
    }

    if (path === "/api/export" && method === "GET") {
      const format = q.get("format") === "json" ? "json" : "csv";
      const result = await listConversations(
        env,
        {
          site: q.get("site"),
          q: q.get("q"),
          from: q.get("from"),
          to: q.get("to"),
          sort: q.get("sort"),
          dir: q.get("dir"),
          limit: 1000,
          offset: 0,
        },
        filtersFromQuery(q),
      );
      const rows = result.items.map((i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const x = i as any;
        return {
          site: i.site,
          ip: i.ip,
          request_count: i.request_count,
          created_at: i.created_at,
          updated_at: i.updated_at,
          messages: i.message_count,
          cta: i.cta,
          intent: x.analysis?.intent ?? "",
          sentiment: x.analysis?.sentiment ?? "",
          lead_score: x.analysis?.lead_score ?? "",
          is_lead: x.analysis?.is_lead ?? "",
          summary: x.analysis?.summary ?? "",
          country: x.geo?.country ?? "",
          starred: x.triage?.starred ?? false,
          lead_status: x.triage?.lead_status ?? "",
          preview: i.preview,
        };
      });
      if (format === "json") {
        return new Response(JSON.stringify(rows, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="chatlogs-export.json"`,
          },
        });
      }
      return new Response(toCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="chatlogs-export.csv"`,
        },
      });
    }

    // Bot-improvement report: GET returns the stored report, POST regenerates it.
    if (path === "/api/improve" && (method === "GET" || method === "POST")) {
      const site = q.get("site");
      if (!site) return json({ error: "site is required" }, 400);
      let row = method === "POST" ? await generateReport(env, site) : await getBotReport(env.DASH_DB, site);
      if (!row) return json({ site, report: null });
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(row.report);
      } catch {
        parsed = null;
      }
      return json({
        site: row.site,
        generated_at: row.generated_at,
        window_days: row.window_days,
        conversations_analyzed: row.conversations_analyzed,
        failure_rate: row.failure_rate,
        health_score: row.health_score,
        model: row.model,
        report: parsed,
      });
    }

    // Manual trigger for the analysis pipeline (useful for testing / backfill).
    if (path === "/api/admin/analyze" && method === "POST") {
      const max = clampInt(q.get("max"), 15, 1, 50);
      const analyzed = await analyzePending(env, { maxToProcess: max });
      await runAlerts(env, analyzed);
      return json({ analyzed: analyzed.length, items: analyzed.map((a) => ({ site: a.site, ip: a.ip })) });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return json({ error: "request failed", detail: message }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },

  // Cron Triggers (see wrangler.jsonc): "*/3 * * * *" analysis+alerts, "0 7 * * *" digest.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 7 * * *") {
      ctx.waitUntil(runDigest(env));
      return;
    }
    ctx.waitUntil(
      (async () => {
        try {
          const analyzed = await analyzePending(env, { maxToProcess: 15 });
          await runAlerts(env, analyzed);
        } catch (e) {
          console.error("cron_analyze_error", String(e));
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
