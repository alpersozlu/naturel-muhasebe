import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing e-mail over SMTP. Configured with environment variables so the
 * credentials never touch the code: SMTP_HOST, SMTP_PORT (465 = TLS from
 * the start, anything else = STARTTLS), SMTP_USER, SMTP_PASS and SMTP_FROM
 * ("Naturel Ticaret <adres@…>"). A Gmail account with an app password is
 * enough for a handful of invitations a day; the Supabase mailer is not an
 * option because it only reaches project members.
 */
export function isMailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error("E-posta gönderimi yapılandırılmamış (SMTP_HOST / SMTP_USER / SMTP_PASS)");
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.SMTP_FROM ?? `Naturel Ticaret <${process.env.SMTP_USER}>`;
  await transport.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
}
