import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import {
  brandCreateSchema,
  brandUpdateSchema,
  brandIdSchema,
} from "@/lib/zod-schemas/brand";

export const brandRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.brand.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: "desc" },
      include: { _count: { select: { stores: { where: { deleted_at: null } } } } },
    })
  ),

  get: protectedProcedure.input(brandIdSchema).query(async ({ ctx, input }) => {
    const brand = await ctx.prisma.brand.findUnique({
      where: { id: input.id },
      include: {
        stores: {
          where: { deleted_at: null },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!brand || brand.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return brand;
  }),

  create: adminProcedure.input(brandCreateSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.create({
      data: {
        name: input.name,
        logo_url: input.logo_url || null,
      },
    })
  ),

  update: adminProcedure.input(brandUpdateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.brand.findUnique({ where: { id: input.id } });
    if (!existing || existing.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return ctx.prisma.brand.update({
      where: { id: input.id },
      data: {
        name: input.name,
        logo_url: input.logo_url || null,
      },
    });
  }),

  softDelete: adminProcedure.input(brandIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.update({
      where: { id: input.id },
      data: { deleted_at: new Date() },
    })
  ),

  restore: adminProcedure.input(brandIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.update({
      where: { id: input.id },
      data: { deleted_at: null },
    })
  ),
});
