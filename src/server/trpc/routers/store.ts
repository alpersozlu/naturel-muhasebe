import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "../trpc";
import {
  storeCreateSchema,
  storeUpdateSchema,
  storeIdSchema,
  storesByBrandSchema,
} from "@/lib/zod-schemas/store";

export const storeRouter = router({
  listByBrand: protectedProcedure
    .input(storesByBrandSchema)
    .query(({ ctx, input }) =>
      ctx.prisma.store.findMany({
        where: { brand_id: input.brand_id, deleted_at: null },
        orderBy: { name: "asc" },
      })
    ),

  get: protectedProcedure.input(storeIdSchema).query(async ({ ctx, input }) => {
    const store = await ctx.prisma.store.findUnique({
      where: { id: input.id },
      include: { brand: true },
    });
    if (!store || store.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return store;
  }),

  create: adminProcedure.input(storeCreateSchema).mutation(async ({ ctx, input }) => {
    const brand = await ctx.prisma.brand.findUnique({ where: { id: input.brand_id } });
    if (!brand || brand.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Marka bulunamadı" });
    }
    return ctx.prisma.store.create({
      data: {
        brand_id: input.brand_id,
        name: input.name,
        city: input.city ?? null,
        address: input.address ?? null,
      },
    });
  }),

  update: adminProcedure.input(storeUpdateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.store.findUnique({ where: { id: input.id } });
    if (!existing || existing.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return ctx.prisma.store.update({
      where: { id: input.id },
      data: {
        name: input.name,
        city: input.city ?? null,
        address: input.address ?? null,
      },
    });
  }),

  softDelete: adminProcedure.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: new Date() },
    })
  ),

  restore: adminProcedure.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: null },
    })
  ),
});
