import { router, protectedProcedure } from "../trpc";
import {
  analyticsFilterSchema,
  expenseFilterSchema,
} from "@/lib/zod-schemas/analytics";
import { revenueSummary } from "@/server/services/analytics/revenue";
import { expenseSummary } from "@/server/services/analytics/expense";
import {
  bankCommissionSummary,
  type BankCommissionSummary,
} from "@/server/services/analytics/bank-commission";
import { buildRevenueExcel } from "@/server/services/exports/excel/revenue";
import { buildExpenseExcel } from "@/server/services/exports/excel/expense";
import { isAdmin, getAccessibleStoreIds } from "@/lib/auth/permissions";

async function resolveFilterLabels(
  prisma: typeof import("@/lib/prisma").prisma,
  brand_id?: string,
  store_id?: string
): Promise<{ brandName?: string; storeName?: string }> {
  const [brand, store] = await Promise.all([
    brand_id ? prisma.brand.findUnique({ where: { id: brand_id } }) : null,
    store_id ? prisma.store.findUnique({ where: { id: store_id } }) : null,
  ]);
  return {
    brandName: brand?.name,
    storeName: store?.name,
  };
}

export const analyticsRouter = router({
  revenue: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }) => {
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
            prev_month_total: 0,
            prev_year_total: 0,
            sparkline: [],
            cash_ratio_trend: [],
            by_brand: [],
            weekday_pattern: [],
          };
        }
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
            yearly_with_projection: [],
            ytd_total: 0,
            projected_year_end: 0,
            projected_monthly_avg: 0,
          };
        }
        filter.store_id = ids[0];
      }
      return expenseSummary(ctx.prisma, filter);
    }),

  bankCommission: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }): Promise<BankCommissionSummary> => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          return {
            total: 0,
            total_gross: 0,
            effective_rate: 0,
            active_days: 0,
            prev_month_total: 0,
            prev_year_total: 0,
            sparkline: [],
            yearly_compare: { current_ytd: 0, prev_ytd: 0, months: [] },
            by_bank: [],
          };
        }
        filter.store_id = ids[0];
      }
      return bankCommissionSummary(ctx.prisma, filter);
    }),

  exportRevenue: protectedProcedure
    .input(analyticsFilterSchema)
    .mutation(async ({ ctx, input }) => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          throw new Error("Erişebileceğin mağaza yok");
        }
        filter.store_id = ids[0];
      }
      const [summary, labels] = await Promise.all([
        revenueSummary(ctx.prisma, filter),
        resolveFilterLabels(ctx.prisma, filter.brand_id, filter.store_id),
      ]);
      return buildRevenueExcel({
        summary,
        year: filter.year,
        month: filter.month,
        brandName: labels.brandName,
        storeName: labels.storeName,
      });
    }),

  exportExpense: protectedProcedure
    .input(expenseFilterSchema)
    .mutation(async ({ ctx, input }) => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          throw new Error("Erişebileceğin mağaza yok");
        }
        filter.store_id = ids[0];
      }
      const [summary, labels] = await Promise.all([
        expenseSummary(ctx.prisma, filter),
        resolveFilterLabels(ctx.prisma, filter.brand_id, filter.store_id),
      ]);
      return buildExpenseExcel({
        summary,
        year: filter.year,
        month: filter.month,
        brandName: labels.brandName,
        storeName: labels.storeName,
      });
    }),
});
