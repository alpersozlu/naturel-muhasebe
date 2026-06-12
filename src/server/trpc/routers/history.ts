import type { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { historyFilterSchema } from "@/lib/zod-schemas/history";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";

export const historyRouter = router({
  /**
   * Paginated, filtered list of uploads across all days.
   *
   * Non-admins see only uploads for stores they're assigned to.
   * Cursor-based pagination (uses Upload.id, ordered by uploaded_at desc).
   */
  list: protectedProcedure
    .input(historyFilterSchema)
    .query(async ({ ctx, input }) => {
      // Resolve store scope
      let allowedStoreIds: string[] | null = null;
      if (!isAdmin(ctx.user)) {
        allowedStoreIds = await getAccessibleStoreIds(ctx.user);
        if (allowedStoreIds.length === 0) {
          return { items: [], nextCursor: null, total: 0 };
        }
      }

      // Brand → resolve to stores
      let brandStoreIds: string[] | null = null;
      if (input.brand_id) {
        const stores = await ctx.prisma.store.findMany({
          where: { brand_id: input.brand_id, deleted_at: null },
          select: { id: true },
        });
        brandStoreIds = stores.map((s) => s.id);
        if (brandStoreIds.length === 0) {
          return { items: [], nextCursor: null, total: 0 };
        }
      }

      // Effective store filter
      let storeFilter: string[] | undefined;
      if (input.store_id) {
        storeFilter = [input.store_id];
      } else if (brandStoreIds) {
        storeFilter = brandStoreIds;
      } else if (allowedStoreIds) {
        storeFilter = allowedStoreIds;
      }

      // Date range
      const dateFilter: { gte?: Date; lt?: Date } = {};
      if (input.date_from) {
        dateFilter.gte = new Date(`${input.date_from}T00:00:00.000Z`);
      }
      if (input.date_to) {
        // inclusive end: + 1 day
        const end = new Date(`${input.date_to}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        dateFilter.lt = end;
      }

      const where: Prisma.UploadWhereInput = {
        ...(input.type ? { type: input.type } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.uploaded_by ? { uploaded_by: input.uploaded_by } : {}),
        ...(storeFilter || Object.keys(dateFilter).length > 0
          ? {
              daily_record: {
                ...(storeFilter ? { store_id: { in: storeFilter } } : {}),
                ...(Object.keys(dateFilter).length > 0
                  ? { date: dateFilter }
                  : {}),
              },
            }
          : {}),
      };

      const items = await ctx.prisma.upload.findMany({
        where,
        orderBy: [{ uploaded_at: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          uploaded_by_user: { select: { full_name: true, email: true } },
          daily_record: { include: { store: { include: { brand: true } } } },
          pos_slip: { select: { bank_name: true, net_amount_try: true } },
          store_summary: { select: { sales_total_try: true } },
          bank_receipt: { select: { bank_name: true, amount_try: true } },
          expense: { select: { vendor: true, amount_try: true, category: true } },
          z_report: { select: { net_sales_try: true } },
          dealer_daily_report: { select: { net_sales_try: true, store_code: true } },
        },
      });

      const hasMore = items.length > input.limit;
      const trimmed = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;

      return {
        items: trimmed,
        nextCursor,
        total: trimmed.length,
      };
    }),
});
