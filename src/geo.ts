import type { GeoRow } from "./dashdb";
import { upsertGeo } from "./dashdb";

/**
 * Best-effort IP → geo enrichment via the free ipwho.is API (HTTPS, no key).
 * Results are cached in DASH_DB.geo. Failures are swallowed — geo is optional.
 */
interface IpWhoResponse {
  success?: boolean;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  connection?: { asn?: number; org?: string; isp?: string };
}

export async function lookupGeo(db: D1Database, ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      cf: { cacheTtl: 86400 },
    });
    if (!res.ok) return;
    const d = (await res.json()) as IpWhoResponse;
    if (!d.success) return;
    const row: Omit<GeoRow, "looked_up_at"> = {
      ip,
      country: d.country ?? null,
      country_code: d.country_code ?? null,
      region: d.region ?? null,
      city: d.city ?? null,
      asn: d.connection?.asn ? `AS${d.connection.asn}` : null,
      org: d.connection?.org ?? d.connection?.isp ?? null,
    };
    await upsertGeo(db, row);
  } catch {
    /* best-effort */
  }
}
