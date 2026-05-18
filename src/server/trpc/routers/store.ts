import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";

const storeAdmin = withAudit("Store");
import {
  storeCreateSchema,
  storeUpdateSchema,
  storeIdSchema,
  storesByBrandSchema,
} from "@/lib/zod-schemas/store";
import {
  assertCanAccessBrand,
  assertCanAccessStore,
  getAccessibleStoreIds,
  isAdmin,
} from "@/lib/auth/permissions";

export const storeRouter = router({
  /**
   * Admin → brand'in tüm mağazaları.
   * store_manager/cashier → atanmış oldukları ve brand'e ait olanlar.
   */
  listByBrand: protectedProcedure
    .input(storesByBrandSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessBrand(ctx.user, input.brand_id);
      if (isAdmin(ctx.user)) {
        return ctx.prisma.store.findMany({
          where: { brand_id: input.brand_id, deleted_at: null },
          orderBy: { name: "asc" },
        });
      }
      const accessibleIds = await getAccessibleStoreIds(ctx.user);
      if (accessibleIds.length === 0) return [];
      return ctx.prisma.store.findMany({
        where: {
          id: { in: accessibleIds },
          brand_id: input.brand_id,
          deleted_at: null,
        },
        orderBy: { name: "asc" },
      });
    }),

  get: protectedProcedure.input(storeIdSchema).query(async ({ ctx, input }) => {
    await assertCanAccessStore(ctx.user, input.id);
    const store = await ctx.prisma.store.findUnique({
      where: { id: input.id },
      include: { brand: true },
    });
    if (!store || store.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return store;
  }),

  create: storeAdmin.input(storeCreateSchema).mutation(async ({ ctx, input }) => {
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

  update: storeAdmin.input(storeUpdateSchema).mutation(async ({ ctx, input }) => {
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

  softDelete: storeAdmin.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: new Date() },
    })
  ),

  restore: storeAdmin.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: null },
    })
  ),
});
