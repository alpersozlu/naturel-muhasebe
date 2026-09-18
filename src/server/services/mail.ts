import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing e-mail. Two transports, chosen by what the environment holds:
 *
 *  - Resend (RESEND_API_KEY): one key, no server — the same setup Naturel
 *    Rent's daily summary uses, sender "onboarding@resend.dev" unless
 *    MAIL_FROM names a verified domain. Note Resend delivers mail from
 *    onboarding@resend.dev ONLY to the Resend account's own address; any
 *    other recipient needs a verified domain in Resend.
 *  - SMTP (SMTP_HOST / SMTP_USER / SMTP_PASS, optional SMTP_PORT and
 *    SMTP_FROM): a Gmail app password is enough.
 *
 * Credentials live in the environment, never in code.
 */
const DEFAULT_FROM = "Naturel Ticaret <onboarding@resend.dev>";

/**
 * Resend without a verified domain: the shared onboarding@resend.dev sender
 * only delivers to the Resend account owner's own address; every other
 * recipient is refused with a 403. The UI says so up front instead of
 * letting the admin wait for a mail that cannot arrive.
 */
export function isMailSandbox(): boolean {
  if (!process.env.RESEND_API_KEY) return false;
  return /resend\.dev/i.test(process.env.MAIL_FROM ?? DEFAULT_FROM);
}

/** Turkish, actionable wording for the transport errors an admin can meet. */
export function explainMailError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/only send testing emails|verify a domain|own email address/i.test(m)) {
    return "Posta hesabının alan adı henüz doğrulanmadı; şimdilik yalnız hesap sahibinin kendi adresine mail gidebiliyor. Bu kişiye mesajı \"Mesajı kopyala\" ile WhatsApp'tan gönderin.";
  }
  if (/Resend 401|API key is invalid/i.test(m)) {
    return "Posta anahtarı geçersiz — Vercel'deki RESEND_API_KEY değerini yenileyin.";
  }
  return m;
}

export function isMailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (process.env.RESEND_API_KEY) return sendViaResend(opts);
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return sendViaSmtp(opts);
  throw new Error("E-posta gönderimi yapılandırılmamış (RESEND_API_KEY ya da SMTP_HOST / SMTP_USER / SMTP_PASS)");
}

async function sendViaResend(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text, html: opts.html }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; error?: string };
      detail = j.message ?? j.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Resend ${res.status}: ${detail || res.statusText}`);
  }
}

async function sendViaSmtp(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.SMTP_FROM ?? process.env.MAIL_FROM ?? `Naturel Ticaret <${process.env.SMTP_USER}>`;
  await transport.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
}
