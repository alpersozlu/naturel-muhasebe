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
import {
  profitLossSummary,
  type ProfitLossSummary,
} from "@/server/services/analytics/profit-loss";
import {
  cashVarianceSummary,
  type CashVarianceSummary,
} from "@/server/services/analytics/cash-variance";
import {
  zAnalysisSummary,
  type ZAnalysisSummary,
} from "@/server/services/analytics/z-analysis";
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
            daily_series: [],
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

  cashVariance: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }): Promise<CashVarianceSummary> => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          return {
            period_label: "",
            total_deficit: 0,
            total_surplus: 0,
            net: 0,
            stores_with_deficit: 0,
            stores_count: 0,
            by_store: [],
          };
        }
        filter.store_id = ids[0];
      }
      return cashVarianceSummary(ctx.prisma, filter);
    }),

  zAnalysis: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }): Promise<ZAnalysisSummary> => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          return {
            period_label: "",
            total_z_report: 0,
            total_manual_invoice: 0,
            total_combined: 0,
            total_visa: 0,
            total_sales: 0,
            manual_invoice_share: 0,
            z_over_visa_ratio: 0,
            z_over_sales_ratio: 0,
            by_store: [],
            monthly_trend: [],
            stores_passed: 0,
            stores_below_visa: 0,
            stores_above_sales: 0,
            stores_no_data: 0,
          };
        }
        filter.store_id = ids[0];
      }
      return zAnalysisSummary(ctx.prisma, filter);
    }),

  profitLoss: protectedProcedure
    .input(analyticsFilterSchema)
    .query(async ({ ctx, input }): Promise<ProfitLossSummary> => {
      const filter = { ...input };
      if (!isAdmin(ctx.user) && !filter.store_id && !filter.brand_id) {
        const ids = await getAccessibleStoreIds(ctx.user);
        if (ids.length === 0) {
          const empty = { revenue: 0, commission: 0, expense: 0, loyalty: 0, net: 0, ratio: 0 };
          return { current: empty, prev_month: empty, prev_year: empty };
        }
        filter.store_id = ids[0];
      }
      return profitLossSummary(ctx.prisma, filter);
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
