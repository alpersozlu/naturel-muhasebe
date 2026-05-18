import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";

const brandAdmin = withAudit("Brand");
import {
  brandCreateSchema,
  brandUpdateSchema,
  brandIdSchema,
} from "@/lib/zod-schemas/brand";
import {
  assertCanAccessBrand,
  getAccessibleBrandIds,
  isAdmin,
} from "@/lib/auth/permissions";

export const brandRouter = router({
  /**
   * Admin → tüm markalar.
   * store_manager/cashier → sadece atanmış oldukları mağazaların markaları.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (isAdmin(ctx.user)) {
      return ctx.prisma.brand.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: "desc" },
        include: { _count: { select: { stores: { where: { deleted_at: null } } } } },
      });
    }
    const accessibleIds = await getAccessibleBrandIds(ctx.user);
    if (accessibleIds.length === 0) return [];
    return ctx.prisma.brand.findMany({
      where: { id: { in: accessibleIds }, deleted_at: null },
      orderBy: { created_at: "desc" },
      include: { _count: { select: { stores: { where: { deleted_at: null } } } } },
    });
  }),

  get: protectedProcedure.input(brandIdSchema).query(async ({ ctx, input }) => {
    await assertCanAccessBrand(ctx.user, input.id);
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

  create: brandAdmin.input(brandCreateSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.create({
      data: {
        name: input.name,
        logo_url: input.logo_url || null,
      },
    })
  ),

  update: brandAdmin.input(brandUpdateSchema).mutation(async ({ ctx, input }) => {
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

  softDelete: brandAdmin.input(brandIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.update({
      where: { id: input.id },
      data: { deleted_at: new Date() },
    })
  ),

  restore: brandAdmin.input(brandIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.brand.update({
      where: { id: input.id },
      data: { deleted_at: null },
    })
  ),
});
