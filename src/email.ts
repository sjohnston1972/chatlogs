import type { Env } from "./types";

// EmailMessage from "cloudflare:email" is provided by @cloudflare/workers-types.

/** Build a minimal RFC 5322 message (plain text). */
function buildMime(from: string, to: string, subject: string, body: string): string {
  const date = new Date().toUTCString();
  // Subjects here are ASCII; strip any stray non-ASCII to keep the header valid.
  const safeSubject = subject.replace(/[^\x20-\x7E]/g, "").trim() || "chatlogs";
  return (
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${safeSubject}\r\n` +
    `Date: ${date}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n` +
    `\r\n` +
    body.replace(/\n/g, "\r\n") +
    `\r\n`
  );
}

/**
 * Send an email via the Cloudflare Email Routing send_email binding.
 * No-op (returns false) when the binding or addresses aren't configured.
 */
export async function sendEmail(env: Env, subject: string, body: string): Promise<boolean> {
  if (!env.SEND_EMAIL || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) return false;
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const raw = buildMime(env.ALERT_EMAIL_FROM, env.ALERT_EMAIL_TO, subject, body);
    const msg = new EmailMessage(env.ALERT_EMAIL_FROM, env.ALERT_EMAIL_TO, raw);
    // The binding's send() accepts the EmailMessage instance.
    await env.SEND_EMAIL.send(msg as unknown as object);
    return true;
  } catch (e) {
    console.error("email_send_error", String(e));
    return false;
  }
}
