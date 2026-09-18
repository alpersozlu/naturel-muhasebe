import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  userCreateSchema,
  userUpdateRoleSchema,
  userIdSchema,
  userSetPasswordSchema,
  userSetActiveSchema,
  userSendInviteSchema,
} from "@/lib/zod-schemas/user";
import { recordAuthEvent } from "@/server/services/auth-events";
import { explainMailError, isMailConfigured, isMailSandbox, sendMail } from "@/server/services/mail";

const userAdmin = withAudit("User");

export const userRouter = router({
  /** Mevcut oturum kullanıcısı — UI'da role bazlı filtreleme için. */
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    email: ctx.user.email,
    full_name: ctx.user.full_name,
    role: ctx.user.role,
  })),

  list: adminProcedure.query(({ ctx }) =>
    ctx.prisma.user.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: "desc" },
      include: {
        _count: { select: { store_access: true } },
        store_access: {
          include: { store: { select: { id: true, name: true } } },
        },
      },
    })
  ),

  get: adminProcedure.input(userIdSchema).query(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: { store_access: { include: { store: true } } },
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),

  create: userAdmin.input(userCreateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Bu e-posta zaten kullanılıyor",
      });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: input.full_name ? { full_name: input.full_name } : undefined,
    });
    if (error || !data?.user) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Supabase: ${error?.message ?? "user oluşturulamadı"}`,
      });
    }

    const user = await ctx.prisma.user.create({
      data: {
        id: data.user.id,
        email: input.email,
        full_name: input.full_name ?? null,
        role: input.role,
      },
    });

    // Mağaza ataması (varsa) — yönetici/bölgesel tüm mağazaları görür, atama gerekmez
    if (input.store_id && input.role !== "admin") {
      await ctx.prisma.userStoreAccess.create({
        data: { user_id: user.id, store_id: input.store_id, role: input.role },
      });
    }
    return user;
  }),

  /** Şifre değiştir (admin) — Supabase auth üzerinden. */
  setPassword: userAdmin
    .input(userSetPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.updateUserById(input.id, {
        password: input.password,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Supabase: ${error.message}`,
        });
      }
      const target = await ctx.prisma.user.findUnique({ where: { id: input.id }, select: { email: true } });
      if (target) {
        await recordAuthEvent({ email: target.email, kind: "password_set_by_admin", reason: `by ${ctx.user.email}` });
      }
      return { ok: true };
    }),

  /** Is outgoing e-mail set up (SMTP env)? The invite dialog offers "send" only then. */
  mailConfigured: adminProcedure.query(() => isMailConfigured()),

  /** True while mail can only reach the account owner (no verified domain yet). */
  mailSandbox: adminProcedure.query(() => isMailSandbox()),

  /** Admin: a test message to their own address — proves the mail setup without touching any account. */
  sendTestMail: adminProcedure.mutation(async ({ ctx }) => {
    if (!isMailConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "E-posta gönderimi yapılandırılmamış (Vercel: RESEND_API_KEY ya da SMTP_*).",
      });
    }
    const when = new Date().toLocaleString("tr-TR", { timeZone: "Asia/Nicosia" });
    try {
      await sendMail({
        to: ctx.user.email,
        subject: `Naturel Muhasebe — test e-postası (${when})`,
        text: `Bu bir test mesajıdır. Bu mesajı aldıysanız Naturel Muhasebe e-posta gönderimi çalışıyor.\nGönderim: ${when}`,
        html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111827">
          <p>Bu bir test mesajıdır. Bu mesajı aldıysanız <strong>Naturel Muhasebe</strong> e-posta gönderimi çalışıyor.</p>
          <p style="color:#6b7280;font-size:13px">Gönderim: ${when}</p>
        </div>`,
      });
    } catch (e) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `E-posta gönderilemedi: ${explainMailError(e)}`,
      });
    }
    return { to: ctx.user.email };
  }),

  /**
   * Invitation e-mail (admin): sets the temporary password on the account
   * and mails the login address, e-mail, password and store to the person,
   * so what is sent always matches what is set.
   */
  sendInvite: userAdmin.input(userSendInviteSchema).mutation(async ({ ctx, input }) => {
    if (!isMailConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "E-posta gönderimi yapılandırılmamış (Vercel: RESEND_API_KEY ya da SMTP_*).",
      });
    }
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: { store_access: { include: { store: true } } },
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });

    if (input.password) {
      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.updateUserById(input.id, {
        password: input.password,
      });
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Supabase: ${error.message}` });
      }
      await recordAuthEvent({ email: user.email, kind: "password_set_by_admin", reason: `invite by ${ctx.user.email}` });
    }

    const stores = user.store_access.map((a) => a.store.name).join(", ");
    const firstName = (user.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    const addressee =
      input.salutation === "hanim" && firstName
        ? `${firstName} Hanım`
        : input.salutation === "bey" && firstName
          ? `${firstName} Bey`
          : (user.full_name ?? "").trim();
    const title = addressee ? `Naturel Muhasebe'ye hoş geldiniz, ${addressee}` : "Naturel Muhasebe'ye hoş geldiniz";
    // "@" is legal in a query string; keeping it readable avoids the puzzling
    // "%40" in the message. Everything else stays encoded.
    const link = `${input.login_url}?email=${encodeURIComponent(user.email).replace(/%40/g, "@")}`;
    const lines = [
      title,
      "",
      "Hesabınız hazır. Aşağıdaki bağlantıyı açıp e-posta adresiniz ve geçici şifrenizle giriş yapabilirsiniz.",
      "",
      `Giriş: ${link}`,
      `E-posta: ${user.email}`,
      ...(input.password ? [`Şifre: ${input.password}`] : ["Şifre: yöneticiniz size ayrıca iletecek."]),
      ...(stores ? [`Mağaza: ${stores}`] : []),
      "",
      "Giriş yaptıktan sonra sağ üstteki menüden \"Şifremi değiştir\" ile kendi şifrenizi belirleyebilirsiniz.",
    ];
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const row = (k: string, v: string) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:6px 0;color:#111827">${v}</td></tr>`;
    const html = `<div style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Naturel Ticaret · Muhasebe</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${esc(title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">Hesabınız hazır. Aşağıdaki düğmeye tıklayın, e-posta adresiniz ve geçici şifrenizle giriş yapın.</p>
        <p style="margin:0 0 28px"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Sisteme giriş yap</a></p>
        <table style="border-collapse:collapse;font-size:15px;width:100%">
          ${row("E-posta", esc(user.email))}
          ${input.password
            ? row("Şifre", `<code style="font-size:16px;background:#f3f4f6;padding:2px 8px;border-radius:6px">${esc(input.password)}</code>`)
            : row("Şifre", "yöneticiniz size ayrıca iletecek")}
          ${stores ? row("Mağaza", esc(stores)) : ""}
        </table>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280">Düğme açılmazsa bu adresi tarayıcınıza yapıştırın:<br><a href="${esc(link)}" style="color:#374151">${esc(link)}</a></p>
        <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280">Giriş yaptıktan sonra sağ üstteki menüden &quot;Şifremi değiştir&quot; ile kendi şifrenizi belirleyebilirsiniz.</p>
      </div>
    </div>`;
    try {
      await sendMail({
        to: input.to ?? user.email,
        subject: title,
        text: lines.join("\n"),
        html,
      });
    } catch (e) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `E-posta gönderilemedi: ${explainMailError(e)}`,
      });
    }
    return { ok: true, to: input.to ?? user.email };
  }),

  /** Devre dışı bırak / aktifleştir (admin) — is_active + Supabase ban. */
  setActive: userAdmin
    .input(userSetActiveSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Kendi hesabını devre dışı bırakamazsın",
        });
      }
      const target = await ctx.prisma.user.findUnique({ where: { id: input.id } });
      if (!target || target.deleted_at) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Kullanıcı bulunamadı" });
      }
      // Son admini devre dışı bırakma
      if (!input.is_active && target.role === "admin") {
        const activeAdmins = await ctx.prisma.user.count({
          where: { role: "admin", deleted_at: null, is_active: true },
        });
        if (activeAdmins <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sistemde en az 1 aktif admin kalmalı",
          });
        }
      }

      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.updateUserById(input.id, {
        ban_duration: input.is_active ? "none" : "876000h", // ~100 yıl
      });
      if (error && error.status !== 404) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Supabase: ${error.message}`,
        });
      }
      return ctx.prisma.user.update({
        where: { id: input.id },
        data: { is_active: input.is_active },
      });
    }),

  updateRole: userAdmin
    .input(userUpdateRoleSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.role !== "admin") {
        const adminCount = await ctx.prisma.user.count({
          where: { role: "admin", deleted_at: null },
        });
        const current = await ctx.prisma.user.findUnique({ where: { id: input.id } });
        if (current?.role === "admin" && adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sistemde en az 1 admin kalmalı",
          });
        }
      }
      return ctx.prisma.user.update({
        where: { id: input.id },
        data: {
          role: input.role,
          full_name: input.full_name ?? undefined,
        },
      });
    }),

  /**
   * Kullanıcıyı kaldır (admin):
   * - Supabase auth hesabı silinir → giriş anında ölür
   * - Mağaza erişimleri kaldırılır
   * - Geçmiş kaydı yoksa hard delete; varsa (FK) soft delete — tarihçe korunur
   */
  delete: userAdmin.input(userIdSchema).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Kendi hesabını silemezsin",
      });
    }
    const target = await ctx.prisma.user.findUnique({ where: { id: input.id } });
    if (!target || target.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Kullanıcı bulunamadı" });
    }
    if (target.role === "admin") {
      const adminCount = await ctx.prisma.user.count({
        where: { role: "admin", deleted_at: null },
      });
      if (adminCount <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sistemde en az 1 admin kalmalı",
        });
      }
    }

    const supabase = createAdminClient();
    const { error } = await supabase.auth.admin.deleteUser(input.id);
    if (error && error.status !== 404 && !/not.?found/i.test(error.message)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Supabase: ${error.message}`,
      });
    }

    await ctx.prisma.userStoreAccess.deleteMany({ where: { user_id: input.id } });

    try {
      await ctx.prisma.user.delete({ where: { id: input.id } });
      return { mode: "hard" as const };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        await ctx.prisma.user.update({
          where: { id: input.id },
          data: { deleted_at: new Date() },
        });
        return { mode: "soft" as const };
      }
      throw e;
    }
  }),
});
