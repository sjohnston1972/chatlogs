import type { Env } from "./types";

/**
 * Cloudflare Access JWT verification — defense-in-depth.
 *
 * The PRIMARY access control is the Cloudflare Access policy enforced at the
 * edge: unauthenticated requests to chatlogs.clydeford.net never reach this
 * Worker. This module adds a second layer: when ACCESS_AUD is configured, the
 * Worker independently verifies the signed Access JWT that the edge attaches to
 * every authenticated request, and rejects anything that doesn't validate.
 *
 * If ACCESS_AUD is not set, verification is skipped (the Worker trusts the edge
 * Access policy alone).
 */

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: Jwk[];
}

// Per-isolate cache of imported public keys, keyed by kid.
const keyCache = new Map<string, CryptoKey>();
let keyCacheTeam = "";
let keyCacheExpiry = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

function b64urlToUint8(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(b64url: string): T {
  const bytes = b64urlToUint8(b64url);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function loadKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (keyCacheTeam === teamDomain && now < keyCacheExpiry && keyCache.size > 0) {
    return keyCache;
  }

  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch Access JWKS (${res.status})`);
  }
  const jwks = (await res.json()) as JwksResponse;

  keyCache.clear();
  for (const jwk of jwks.keys) {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyCache.set(jwk.kid, key);
  }
  keyCacheTeam = teamDomain;
  keyCacheExpiry = now + JWKS_TTL_MS;
  return keyCache;
}

export interface AccessIdentity {
  email?: string;
  sub?: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  identity?: AccessIdentity;
}

/** Extract the Access JWT from the request (header or cookie). */
function extractToken(request: Request): string | null {
  const headerToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (headerToken) return headerToken;

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Verify the Access JWT. Returns ok:true and the caller identity when valid.
 * When ACCESS_AUD is unset, verification is skipped (ok:true).
 */
export async function verifyAccess(request: Request, env: Env): Promise<VerifyResult> {
  const aud = env.ACCESS_AUD;
  const team = env.ACCESS_TEAM_DOMAIN;

  // Not configured for in-Worker verification — rely on edge Access.
  if (!aud || !team) return { ok: true };

  const token = extractToken(request);
  if (!token) return { ok: false, reason: "missing Access token" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };

  let header: { kid?: string; alg?: string };
  let payload: {
    aud?: string | string[];
    iss?: string;
    exp?: number;
    nbf?: number;
    email?: string;
    sub?: string;
  };
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: "undecodable token" };
  }

  if (header.alg !== "RS256" || !header.kid) {
    return { ok: false, reason: "unexpected token algorithm" };
  }

  // Validate claims.
  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(aud)) return { ok: false, reason: "audience mismatch" };
  if (payload.iss !== `https://${team}`) return { ok: false, reason: "issuer mismatch" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && nowSec >= payload.exp) {
    return { ok: false, reason: "token expired" };
  }
  if (payload.nbf !== undefined && nowSec < payload.nbf) {
    return { ok: false, reason: "token not yet valid" };
  }

  // Verify signature.
  let keys: Map<string, CryptoKey>;
  try {
    keys = await loadKeys(team);
  } catch {
    return { ok: false, reason: "unable to load signing keys" };
  }
  const key = keys.get(header.kid);
  if (!key) return { ok: false, reason: "unknown signing key" };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToUint8(parts[2]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    sig as unknown as BufferSource,
    signed as unknown as BufferSource,
  );
  if (!valid) return { ok: false, reason: "invalid signature" };

  return { ok: true, identity: { email: payload.email, sub: payload.sub } };
}
