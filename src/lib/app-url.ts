import "server-only";

/**
 * Public base URL for links that go out by e-mail (password recovery).
 *
 * Decided on the server only. The request's Host is used when it is one of
 * the project's own hosts, so the link returns to the address the person
 * is actually using (Vercel domain today, the custom domain later) without
 * any configuration. A client-supplied origin is never trusted: a recovery
 * link carries a one-time token, and pointing it at someone else's site
 * would hand that token over.
 */
const OWN_DOMAIN = "natureltrading.com";
// Production host on Vercel — the fallback when the platform's system
// variables are not exposed to the function.
const KNOWN_PRODUCTION_HOST = "naturel-muhasebe-7emg.vercel.app";

const isLocal = (h: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);

/**
 * Same as resolveAppBase, for links that go out by e-mail with no request
 * host to lean on: an env URL whose host does not resolve in DNS yet (the
 * custom domain before its CNAME exists — measured 2026-09-22, the alert
 * mail's button led to NXDOMAIN) is skipped in favour of the platform host.
 */
export async function resolveAppBaseForMail(hostHeader: string | null | undefined): Promise<string> {
  const base = resolveAppBase(hostHeader);
  let host = "";
  try {
    host = new URL(base).host;
  } catch {
    return base;
  }
  if (isLocal(host) || host.endsWith(".vercel.app")) return base;
  const cached = dnsOk.get(host);
  if (cached !== undefined && Date.now() - cached.at < 10 * 60_000) return cached.ok ? base : platformBase();
  let ok = true;
  try {
    const { lookup } = await import("node:dns/promises");
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 1_500)),
    ]);
  } catch {
    ok = false;
  }
  dnsOk.set(host, { ok, at: Date.now() });
  return ok ? base : platformBase();
}
const dnsOk = new Map<string, { ok: boolean; at: number }>();
function platformBase(): string {
  return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || KNOWN_PRODUCTION_HOST}`;
}

export function resolveAppBase(hostHeader: string | null | undefined): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  let envHost: string | null = null;
  try {
    envHost = envUrl ? new URL(envUrl).host.toLowerCase() : null;
  } catch {
    envHost = null;
  }
  const own = new Set<string>([KNOWN_PRODUCTION_HOST]);
  if (envHost && !isLocal(envHost)) own.add(envHost);
  for (const v of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (v) own.add(v.toLowerCase());
  }

  const host = (hostHeader ?? "").trim().toLowerCase();
  if (host && (own.has(host) || host === OWN_DOMAIN || host.endsWith(`.${OWN_DOMAIN}`))) {
    return `https://${host}`;
  }
  if (process.env.NODE_ENV !== "production" && isLocal(host)) return `http://${host}`;
  if (envUrl && envHost && !isLocal(envHost)) return envUrl;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return `https://${KNOWN_PRODUCTION_HOST}`;
}
