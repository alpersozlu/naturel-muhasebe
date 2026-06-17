import type { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { nebimSalesFilterSchema } from "@/lib/zod-schemas/nebim-sales";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";

const EMPTY_SUMMARY = {
  lines: 0,
  invoices: 0,
  net_total: 0,
  date_min: null as Date | null,
  date_max: null as Date | null,
  by_store: [] as Array<{
    store_id: string | null;
    store_name: string | null;
    lines: number;
    net: number;
  }>,
};

export const nebimSalesRouter = router({
  /**
   * Filtreli, sayfalı (cursor) NEBIM perakende satış listesi + filtre-geneli özet.
   * Admin tüm mağazaları görür; diğer kullanıcılar yalnız erişimli mağazaları.
   */
  list: protectedProcedure
    .input(nebimSalesFilterSchema)
    .query(async ({ ctx, input }) => {
      // Mağaza kapsamı
      let allowedStoreIds: string[] | null = null;
      if (!isAdmin(ctx.user)) {
        allowedStoreIds = await getAccessibleStoreIds(ctx.user);
        if (allowedStoreIds.length === 0) {
          return { items: [], nextCursor: null, summary: EMPTY_SUMMARY };
        }
      }

      let storeFilter: string[] | undefined;
      if (input.store_id) storeFilter = [input.store_id];
      else if (allowedStoreIds) storeFilter = allowedStoreIds;

      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (input.date_from) dateFilter.gte = new Date(`${input.date_from}T00:00:00.000Z`);
      if (input.date_to) dateFilter.lte = new Date(`${input.date_to}T00:00:00.000Z`);

      const where: Prisma.NebimSaleLineWhereInput = {
        ...(storeFilter ? { store_id: { in: storeFilter } } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { invoice_date: dateFilter } : {}),
        ...(input.only_returns ? { is_return: true } : {}),
      };

      const rows = await ctx.prisma.nebimSaleLine.findMany({
        where,
        orderBy: [
          { invoice_date: "desc" },
          { invoice_ref: "desc" },
          { sort_order: "asc" },
        ],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { store: { select: { name: true } } },
      });

      const hasMore = rows.length > input.limit;
      const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? trimmed[trimmed.length - 1]!.id : null;

      const items = trimmed.map((r) => ({
        id: r.id,
        invoice_ref: r.invoice_ref,
        sort_order: r.sort_order,
        invoice_date: r.invoice_date,
        store_name: r.store?.name ?? r.store_name_raw,
        is_return: r.is_return,
        item_code: r.item_code,
        item_desc: r.item_desc,
        color_desc: r.color_desc,
        size: r.size,
        salesperson_name: r.salesperson_name,
        qty: Number(r.qty),
        net_amount: r.net_amount == null ? null : Number(r.net_amount),
      }));

      // Özet — sayfa değil, TÜM filtre için
      const [agg, byStoreRaw, invoiceGroups, stores] = await Promise.all([
        ctx.prisma.nebimSaleLine.aggregate({
          where,
          _count: { _all: true },
          _sum: { net_amount: true },
          _min: { invoice_date: true },
          _max: { invoice_date: true },
        }),
        ctx.prisma.nebimSaleLine.groupBy({
          by: ["store_id"],
          where,
          _count: { _all: true },
          _sum: { net_amount: true },
        }),
        ctx.prisma.nebimSaleLine.groupBy({
          by: ["company_code", "invoice_ref"],
          where,
        }),
        ctx.prisma.store.findMany({ select: { id: true, name: true } }),
      ]);

      const nameOf = new Map(stores.map((s) => [s.id, s.name]));
      const by_store = byStoreRaw
        .map((g) => ({
          store_id: g.store_id,
          store_name: g.store_id ? nameOf.get(g.store_id) ?? null : null,
          lines: g._count._all,
          net: Number(g._sum.net_amount ?? 0),
        }))
        .sort((a, b) => b.net - a.net);

      return {
        items,
        nextCursor,
        summary: {
          lines: agg._count._all,
          invoices: invoiceGroups.length,
          net_total: Number(agg._sum.net_amount ?? 0),
          date_min: agg._min.invoice_date,
          date_max: agg._max.invoice_date,
          by_store,
        },
      };
    }),
});
