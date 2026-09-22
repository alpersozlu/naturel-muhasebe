import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../trpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMailConfigured, sendMail } from "@/server/services/mail";
import { resolveAppBaseForMail } from "@/lib/app-url";
import { recordAuthEvent, requestMeta } from "@/server/services/auth-events";

/**
 * Password self-service.
 *
 * forgotPassword: with the app's own mail transport the recovery link is
 * built here and points straight at OUR reset page with a one-time token
 * hash (`?token_hash=…&type=recovery`); the page verifies it with
 * verifyOtp. Nothing depends on Supabase's "Site URL" / redirect allow-list
 * (measured 2026-09-18: a Supabase-side redirect fell back to a Site URL of
 * localhost:3000 and stranded the admin), the link works in any browser,
 * and it reaches store managers (Supabase's built-in mailer only reaches
 * project members). The link's host is decided on the server — see
 * resolveAppBase. Without a transport the client falls back to Supabase's
 * resetPasswordForEmail. The response never says whether the address exists.
 */
const cooldown = new Map<string, number>(); // best effort per instance
const failureBurst = new Map<string, { n: number; since: number }>(); // per IP

export const authRouter = router({
  forgotPassword: publicProcedure
    .input(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        // Accepted for older cached clients; deliberately unused.
        origin: z.string().max(200).optional(),
        locale: z.enum(["tr", "en"]).default("tr"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isMailConfigured()) {
        await recordAuthEvent({ email: input.email, kind: "recovery_requested", reason: "via_supabase_mailer" });
        return { via: "supabase" as const };
      }

      const last = cooldown.get(input.email) ?? 0;
      if (Date.now() - last < 60_000) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Bir dakika içinde yeniden istenemez — gelen kutunuzu (ve Spam'i) kontrol edin.",
        });
      }
      cooldown.set(input.email, Date.now());

      const user = await ctx.prisma.user.findUnique({ where: { email: input.email } });
      if (!user || user.deleted_at || !user.is_active) {
        await recordAuthEvent({
          email: input.email,
          kind: "recovery_requested",
          reason: !user || user.deleted_at ? "no_such_user" : "inactive",
        });
        return { via: "mail" as const };
      }

      const base = await resolveAppBaseForMail(requestMeta().host);
      const supabase = createAdminClient();
      const { data, error } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: input.email,
      });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) {
        cooldown.delete(input.email);
        console.error("[auth.forgotPassword] generateLink failed", error?.message);
        await recordAuthEvent({ email: input.email, kind: "recovery_requested", reason: `link_failed: ${error?.message ?? "no token"}` });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bağlantı üretilemedi — yöneticinize yazın." });
      }
      const link = `${base}/${input.locale}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
      const name = user.full_name?.trim() || user.email;
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      try {
        await sendMail({
          to: user.email,
          subject: "Naturel Muhasebe — şifre sıfırlama",
          text: [
            `Merhaba ${name},`,
            "",
            "Şifrenizi yenilemek için aşağıdaki bağlantıyı açın (1 saat geçerlidir, bir kez kullanılır):",
            link,
            "",
            "Bu isteği siz yapmadıysanız bu maili yok sayabilirsiniz; şifreniz değişmez.",
          ].join("\n"),
          html: `<div style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
            <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
              <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Naturel Ticaret · Muhasebe</p>
              <h1 style="margin:0 0 16px;font-size:22px;color:#111827">Şifre sıfırlama</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">Merhaba ${esc(name)}, şifrenizi yenilemek için düğmeye tıklayın. Bağlantı 1 saat geçerlidir ve bir kez kullanılır.</p>
              <p style="margin:0 0 28px"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Yeni şifre belirle</a></p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">Bu isteği siz yapmadıysanız bu maili yok sayabilirsiniz; şifreniz değişmez.</p>
            </div>
          </div>`,
        });
      } catch (e) {
        cooldown.delete(input.email);
        console.error("[auth.forgotPassword] mail failed", e);
        await recordAuthEvent({
          email: input.email,
          kind: "recovery_requested",
          reason: `mail_failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "E-posta gönderilemedi — yöneticinizden şifrenizi yenilemesini isteyin.",
        });
      }
      await recordAuthEvent({ email: input.email, kind: "recovery_requested", reason: "mail_sent" });
      return { via: "mail" as const };
    }),

  /**
   * The login page reports a rejected sign-in here. The server adds what it
   * knows about the address (registered? active? banned?) so support can
   * tell a typo in the e-mail from a wrong password. Nothing is returned to
   * the caller, and the password never leaves the browser's Supabase call.
   */
  noteFailedLogin: publicProcedure
    .input(z.object({ email: z.string().trim().toLowerCase().max(200), code: z.string().max(60).optional() }))
    .mutation(async ({ ctx, input }) => {
      const ip = requestMeta().ip ?? "unknown";
      const now = Date.now();
      const b = failureBurst.get(ip);
      if (b && now - b.since < 10 * 60_000) {
        if (b.n >= 30) return { ok: true };
        b.n += 1;
      } else {
        failureBurst.set(ip, { n: 1, since: now });
      }
      let reason = input.code || "unknown";
      try {
        const user = await ctx.prisma.user.findUnique({ where: { email: input.email } });
        if (!user || user.deleted_at) reason = `${reason}; no_such_user`;
        else if (!user.is_active) reason = `${reason}; inactive`;
        else reason = `${reason}; user_exists`;
      } catch {
        // keep the client's code only
      }
      await recordAuthEvent({ email: input.email, kind: "login_failed", reason });
      return { ok: true };
    }),

  /** Called right after a successful sign-in / recovery (session required). */
  noteLogin: protectedProcedure
    .input(z.object({ kind: z.enum(["login_ok", "recovery_completed"]).default("login_ok") }))
    .mutation(async ({ ctx, input }) => {
      await recordAuthEvent({ email: ctx.user.email, kind: input.kind });
      return { ok: true, role: ctx.user.role };
    }),

  /**
   * Signed-in person sets their own new password. The current password is
   * checked first (throw-away client, no cookies) so an unattended store PC
   * cannot be used to lock its owner out.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        current: z.string().min(1, "Mevcut şifrenizi yazın").max(200),
        password: z.string().min(6, "En az 6 karakter").max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const probe = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
      );
      const check = await probe.auth.signInWithPassword({ email: ctx.user.email, password: input.current });
      if (check.error) {
        await recordAuthEvent({ email: ctx.user.email, kind: "password_changed", reason: "current_password_rejected" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mevcut şifre hatalı." });
      }
      // Drop only the probe's own session.
      await probe.auth.signOut({ scope: "local" }).catch(() => undefined);

      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.updateUserById(ctx.user.id, { password: input.password });
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Şifre güncellenemedi: ${error.message}` });
      }
      await recordAuthEvent({ email: ctx.user.email, kind: "password_changed", reason: "self_service" });
      return { ok: true };
    }),

  /** Admin: latest sign-in / password events. */
  recentEvents: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.authEvent.findMany({
        orderBy: { created_at: "desc" },
        take: input?.limit ?? 30,
        select: { id: true, created_at: true, email: true, kind: true, reason: true, ip: true, user_agent: true },
      });
    }),
});
