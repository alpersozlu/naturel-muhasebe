import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type AuthEventKind =
  | "login_ok"
  | "login_failed"
  | "recovery_requested"
  | "recovery_completed"
  | "password_changed"
  | "password_set_by_admin";

/** Caller's IP and browser, from the proxy headers. */
export function requestMeta(): { ip: string | null; userAgent: string | null; host: string | null } {
  try {
    const h = headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return {
      ip,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      host: h.get("x-forwarded-host") ?? h.get("host"),
    };
  } catch {
    return { ip: null, userAgent: null, host: null };
  }
}

/**
 * Append one event. Never throws — the log must not break a sign-in — and
 * never receives a password. Old rows are pruned opportunistically.
 */
export async function recordAuthEvent(e: {
  email: string;
  kind: AuthEventKind;
  reason?: string | null;
}): Promise<void> {
  try {
    const meta = requestMeta();
    await prisma.authEvent.create({
      data: {
        email: e.email.trim().toLowerCase().slice(0, 200),
        kind: e.kind,
        reason: e.reason?.slice(0, 120) ?? null,
        ip: meta.ip,
        user_agent: meta.userAgent,
      },
    });
    if (Math.random() < 0.05) {
      await prisma.authEvent.deleteMany({
        where: { created_at: { lt: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
      });
    }
  } catch (err) {
    console.error("[auth-events] record failed", err);
  }
}
