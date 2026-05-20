import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  userCreateSchema,
  userUpdateRoleSchema,
  userIdSchema,
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
      orderBy: { created_at: "desc" },
      include: {
        _count: { select: { store_access: true } },
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

    return ctx.prisma.user.create({
      data: {
        id: data.user.id,
        email: input.email,
        full_name: input.full_name ?? null,
        role: input.role,
      },
    });
  }),

  updateRole: userAdmin
    .input(userUpdateRoleSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.role !== "admin") {
        const adminCount = await ctx.prisma.user.count({ where: { role: "admin" } });
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
});
