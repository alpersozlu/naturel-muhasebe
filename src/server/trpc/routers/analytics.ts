import { router, protectedProcedure } from "../trpc";
import {
  analyticsFilterSchema,
  expenseFilterSchema,
} from "@/lib/zod-schemas/analytics";
import { revenueSummary } from "@/server/services/analytics/revenue";
import { expenseSummary } from "@/server/services/analytics/expense";
import { isAdmin, getAccessibleStoreIds } from "@/lib/auth/permissions";

export const analyticsRouter = router({
  revenue: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }) => {
      // Non-admin → scope to accessible stores
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          return {
            total: 0,
            cash: 0,
            pos: 0,
            loyalty: 0,
            daily_avg: 0,
            active_days: 0,
            daily_series: [],
            by_store: [],
            by_bank: [],
          };
        }
        // Fall through; if more than one store, run query without filter
        // but limited by store_id check inside summary by passing brand_id
        // For simplicity, only the first accessible store is auto-selected
        filter.store_id = ids[0];
      }
      return revenueSummary(ctx.prisma, filter);
    }),

  expense: protectedProcedure
    .input(expenseFilterSchema)
    .query(async ({ ctx, input }) => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          return {
            total: 0,
            count: 0,
            monthly_trend: [],
            by_category: [],
            by_store: [],
            by_employee: [],
          };
        }
        filter.store_id = ids[0];
      }
      return expenseSummary(ctx.prisma, filter);
    }),
});
