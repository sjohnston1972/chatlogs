import type { Env } from "./types";
import { setMeta } from "./dashdb";
import { createMimeMessage } from "mimetext";

// EmailMessage from "cloudflare:email" is provided by @cloudflare/workers-types.

/** Build a fully-compliant RFC 5322 message via mimetext (Cloudflare's recommended path). */
function buildMime(from: string, to: string, subject: string, body: string): string {
  const safeSubject = subject.replace(/[^\x20-\x7E]/g, "").trim() || "chatlogs";
  const msg = createMimeMessage();
  msg.setSender({ name: "chatlogs", addr: from });
  msg.setRecipient(to);
  msg.setSubject(safeSubject);
  msg.addMessage({ contentType: "text/plain", data: body });
  return msg.asRaw();
}

/**
 * Send an email via the Cloudflare Email Routing send_email binding.
 * Records the outcome to DASH_DB meta (`last_email_result`) for diagnostics.
 * Returns false (no-op) when the binding or addresses aren't configured.
 */
export async function sendEmail(env: Env, subject: string, body: string): Promise<boolean> {
  if (!env.SEND_EMAIL || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) {
    await recordResult(env, { ok: false, error: "binding/addresses not configured", subject });
    return false;
  }
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const raw = buildMime(env.ALERT_EMAIL_FROM, env.ALERT_EMAIL_TO, subject, body);
    const msg = new EmailMessage(env.ALERT_EMAIL_FROM, env.ALERT_EMAIL_TO, raw);
    await env.SEND_EMAIL.send(msg as unknown as object);
    await recordResult(env, { ok: true, subject });
    return true;
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("email_send_error", error);
    await recordResult(env, { ok: false, error, subject });
    return false;
  }
}

async function recordResult(
  env: Env,
  r: { ok: boolean; error?: string; subject: string },
): Promise<void> {
  try {
    await setMeta(env.DASH_DB, "last_email_result", JSON.stringify({ ...r, at: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}
