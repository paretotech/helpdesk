/**
 * ShipHub Helpdesk — Contact form -> Postmark
 *
 * Deploy as a Cloudflare Worker. The Postmark token is never in this file;
 * it lives as an encrypted secret in the Cloudflare dashboard and is
 * injected at runtime via `env.POSTMARK_TOKEN`.
 *
 * Required environment variables (set in Cloudflare dashboard
 *   → Workers → your worker → Settings → Variables and Secrets):
 *
 *   POSTMARK_TOKEN  (Secret) — Postmark Server API token
 *   FROM_EMAIL      (Variable) — verified Postmark sender, e.g. "help@shiphub.ai"
 *   TO_EMAIL        (Variable) — destination, e.g. "support@shiphub.ai"
 */

const ALLOWED_ORIGIN = 'https://help.shiphub.ai';
const POSTMARK_API = 'https://api.postmarkapp.com/email';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return cors(json({ error: 'Method not allowed' }, 405));

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(json({ error: 'Invalid JSON' }, 400));
    }

    const { name, email, subject, message, _trap } = body || {};

    // Honeypot — bots fill every field; humans don't see this one.
    if (_trap) return cors(json({ ok: true }));

    if (!name || !email || !subject || !message) {
      return cors(json({ error: 'Missing required fields' }, 400));
    }
    if (
      typeof name !== 'string' || name.length > 200 ||
      typeof email !== 'string' || email.length > 200 ||
      typeof subject !== 'string' || subject.length > 200 ||
      typeof message !== 'string' || message.length > 5000
    ) {
      return cors(json({ error: 'Invalid input' }, 400));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return cors(json({ error: 'Invalid email address' }, 400));
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || 'unknown';

    const textBody =
      `New help center message\n\n` +
      `Name:    ${name}\n` +
      `Email:   ${email}\n` +
      `Subject: ${subject}\n\n` +
      `--- Message ---\n${message}\n\n` +
      `--- Meta ---\n` +
      `IP: ${ip}\nUA: ${ua}\n`;

    const htmlBody =
      `<h2 style="font-family:sans-serif;color:#0F172A;margin:0 0 12px">New help center message</h2>` +
      `<table style="font-family:sans-serif;font-size:14px;color:#334155;border-collapse:collapse">` +
        `<tr><td style="padding:4px 12px 4px 0;color:#64748B">Name</td><td>${escapeHtml(name)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#64748B">Email</td><td>${escapeHtml(email)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#64748B">Subject</td><td>${escapeHtml(subject)}</td></tr>` +
      `</table>` +
      `<hr style="border:none;border-top:1px solid #E2E8F0;margin:18px 0">` +
      `<div style="font-family:sans-serif;font-size:14px;color:#0F172A;white-space:pre-wrap;line-height:1.55">${escapeHtml(message)}</div>` +
      `<hr style="border:none;border-top:1px solid #E2E8F0;margin:18px 0">` +
      `<div style="font-family:sans-serif;font-size:12px;color:#94A3B8">IP ${escapeHtml(ip)} · ${escapeHtml(ua)}</div>`;

    const pmResp = await fetch(POSTMARK_API, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_TOKEN,
      },
      body: JSON.stringify({
        From: env.FROM_EMAIL,
        To: env.TO_EMAIL,
        ReplyTo: `${name} <${email}>`,
        Subject: `[Helpdesk] ${subject}`,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
      }),
    });

    if (!pmResp.ok) {
      const detail = await pmResp.text().catch(() => '');
      console.log('Postmark error', pmResp.status, detail);
      return cors(json({ error: 'Email service error' }, 502));
    }

    return cors(json({ ok: true }));
  },
};

function cors(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  r.headers.set('Access-Control-Max-Age', '86400');
  return r;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
