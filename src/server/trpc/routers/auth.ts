import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMailConfigured, sendMail } from "@/server/services/mail";

/**
 * Password self-service.
 *
 * forgotPassword: when the app's own mail transport is configured the
 * recovery link is generated server-side and sent through it — it then
 * reaches store managers too (Supabase's built-in mailer only reaches
 * project members) and works from any browser (no PKCE verifier needed:
 * the link carries its own tokens). Without a transport the client falls
 * back to Supabase's resetPasswordForEmail. The response never says
 * whether the address exists.
 */
const cooldown = new Map<string, number>(); // best effort per instance

export const authRouter = router({
  forgotPassword: publicProcedure
    .input(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        origin: z.string().url().max(200),
        locale: z.enum(["tr", "en"]).default("tr"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isMailConfigured()) return { via: "supabase" as const };

      const last = cooldown.get(input.email) ?? 0;
      if (Date.now() - last < 60_000) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Bir dakika içinde yeniden istenemez — gelen kutunuzu (ve Spam'i) kontrol edin.",
        });
      }
      cooldown.set(input.email, Date.now());

      const user = await ctx.prisma.user.findUnique({ where: { email: input.email } });
      if (!user || user.deleted_at || !user.is_active) return { via: "mail" as const };

      const base = process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")
        ? process.env.NEXT_PUBLIC_APP_URL
        : input.origin;
      const redirectTo = `${base.replace(/\/$/, "")}/${input.locale}/reset-password`;

      const supabase = createAdminClient();
      const { data, error } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: input.email,
        options: { redirectTo },
      });
      if (error || !data?.properties?.action_link) {
        console.error("[auth.forgotPassword] generateLink failed", error?.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bağlantı üretilemedi — yöneticinize yazın." });
      }
      const link = data.properties.action_link;
      const name = user.full_name?.trim() || user.email;
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      try {
        await sendMail({
          to: user.email,
          subject: "Naturel Muhasebe — şifre sıfırlama",
          text: [
            `Merhaba ${name},`,
            "",
            "Şifrenizi yenilemek için aşağıdaki bağlantıyı açın (1 saat geçerlidir):",
            link,
            "",
            "Bu isteği siz yapmadıysanız bu maili yok sayabilirsiniz; şifreniz değişmez.",
          ].join("\n"),
          html: `<div style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
            <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
              <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Naturel Ticaret · Muhasebe</p>
              <h1 style="margin:0 0 16px;font-size:22px;color:#111827">Şifre sıfırlama</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">Merhaba ${esc(name)}, şifrenizi yenilemek için düğmeye tıklayın. Bağlantı 1 saat geçerlidir.</p>
              <p style="margin:0 0 28px"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Yeni şifre belirle</a></p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">Bu isteği siz yapmadıysanız bu maili yok sayabilirsiniz; şifreniz değişmez.</p>
            </div>
          </div>`,
        });
      } catch (e) {
        console.error("[auth.forgotPassword] mail failed", e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "E-posta gönderilemedi — yöneticinize yazın." });
      }
      return { via: "mail" as const };
    }),

  /** Signed-in person sets their own new password. */
  changePassword: protectedProcedure
    .input(z.object({ password: z.string().min(6, "En az 6 karakter") }))
    .mutation(async ({ ctx, input }) => {
      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.updateUserById(ctx.user.id, { password: input.password });
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Şifre güncellenemedi: ${error.message}` });
      }
      return { ok: true };
    }),
});
