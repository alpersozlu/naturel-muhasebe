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
} from "@/lib/zod-schemas/user";

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
    .mutation(async ({ input }) => {
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
      return { ok: true };
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
