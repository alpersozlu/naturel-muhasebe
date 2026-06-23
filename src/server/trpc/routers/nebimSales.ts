import type { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import {
  nebimSalesFilterSchema,
  nebimAnalizSchema,
  nebimCustomerProductsSchema,
} from "@/lib/zod-schemas/nebim-sales";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";

/** Filtre (mağaza kapsamı + tarih + iade) → Prisma where. Erişim yoksa null. */
async function buildWhere(
  ctx: { user: unknown; prisma: unknown },
  input: { store_id?: string; date_from?: string; date_to?: string; only_returns?: boolean }
): Promise<Prisma.NebimSaleLineWhereInput | null> {
  // ctx tiplerini gevşek aldık; gerçek erişim kontrolü aşağıda.
  const c = ctx as { user: Parameters<typeof isAdmin>[0] };
  let allowed: string[] | null = null;
  if (!isAdmin(c.user)) {
    allowed = await getAccessibleStoreIds(c.user);
    if (allowed.length === 0) return null;
  }
  let storeFilter: string[] | undefined;
  if (input.store_id) storeFilter = [input.store_id];
  else if (allowed) storeFilter = allowed;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (input.date_from) dateFilter.gte = new Date(`${input.date_from}T00:00:00.000Z`);
  if (input.date_to) dateFilter.lte = new Date(`${input.date_to}T00:00:00.000Z`);

  return {
    ...(storeFilter ? { store_id: { in: storeFilter } } : {}),
    ...(Object.keys(dateFilter).length > 0 ? { invoice_date: dateFilter } : {}),
    ...(input.only_returns ? { is_return: true } : {}),
  };
}

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
        customer_name: r.customer_name,
        payment_type: r.payment_type,
        card_type: r.card_type,
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

  /**
   * Satış analizi — personel / müşteri / mağaza kırılımı (tarih aralığına göre).
   * Net = sum(net_amount) (iadeler negatif → kendiliğinden düşer).
   */
  analiz: protectedProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => {
      const where = await buildWhere(ctx, input);
      const empty = {
        kpi: { net_total: 0, invoices: 0, lines: 0 },
        by_salesperson: [] as Array<{ name: string; net: number; lines: number; invoices: number }>,
        by_customer: [] as Array<{ name: string; net: number; lines: number; invoices: number }>,
        by_store: [] as Array<{ store_name: string | null; net: number; lines: number }>,
        by_payment: [] as Array<{ label: string; net: number; lines: number; invoices: number }>,
      };
      if (!where) return empty;

      const custWhere: Prisma.NebimSaleLineWhereInput = {
        ...where,
        customer_name: { not: null },
      };

      const [
        agg,
        bySales,
        salesInv,
        byCust,
        custInv,
        byStoreRaw,
        byPayRaw,
        payInv,
        invoiceGroups,
        stores,
      ] = await Promise.all([
        ctx.prisma.nebimSaleLine.aggregate({ where, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["salesperson_name"], where, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["salesperson_name", "invoice_ref"], where }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["customer_name"], where: custWhere, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["customer_name", "invoice_ref"], where: custWhere }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["store_id"], where, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["payment_type"], where, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["payment_type", "invoice_ref"], where }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["company_code", "invoice_ref"], where }),
        ctx.prisma.store.findMany({ select: { id: true, name: true } }),
      ]);

      const salesFis = new Map<string, number>();
      for (const g of salesInv) {
        const k = g.salesperson_name ?? "—";
        salesFis.set(k, (salesFis.get(k) ?? 0) + 1);
      }
      const custFis = new Map<string, number>();
      for (const g of custInv) {
        const k = g.customer_name ?? "—";
        custFis.set(k, (custFis.get(k) ?? 0) + 1);
      }

      const by_salesperson = bySales
        .map((g) => ({
          name: g.salesperson_name ?? "—",
          net: Number(g._sum.net_amount ?? 0),
          lines: g._count._all,
          invoices: salesFis.get(g.salesperson_name ?? "—") ?? 0,
        }))
        .sort((a, b) => b.net - a.net);

      const by_customer = byCust
        .map((g) => ({
          name: g.customer_name ?? "—",
          net: Number(g._sum.net_amount ?? 0),
          lines: g._count._all,
          invoices: custFis.get(g.customer_name ?? "—") ?? 0,
        }))
        .sort((a, b) => b.net - a.net)
        .slice(0, 300);

      const nameOf = new Map(stores.map((s) => [s.id, s.name]));
      const by_store = byStoreRaw
        .map((g) => ({
          store_name: g.store_id ? nameOf.get(g.store_id) ?? null : null,
          net: Number(g._sum.net_amount ?? 0),
          lines: g._count._all,
        }))
        .sort((a, b) => b.net - a.net);

      // Ödeme tipi — boş/null genelde iade satırı (ödeme satırı yok)
      const UNSET_PAY = "(İade/Tanımsız)";
      const payFis = new Map<string, number>();
      for (const g of payInv) {
        const k = g.payment_type ?? UNSET_PAY;
        payFis.set(k, (payFis.get(k) ?? 0) + 1);
      }
      const by_payment = byPayRaw
        .map((g) => {
          const label = g.payment_type ?? UNSET_PAY;
          return {
            label,
            net: Number(g._sum.net_amount ?? 0),
            lines: g._count._all,
            invoices: payFis.get(label) ?? 0,
          };
        })
        .sort((a, b) => b.net - a.net);

      return {
        kpi: {
          net_total: Number(agg._sum.net_amount ?? 0),
          invoices: invoiceGroups.length,
          lines: agg._count._all,
        },
        by_salesperson,
        by_customer,
        by_store,
        by_payment,
      };
    }),

  /** Bir müşterinin aldığı ürünler (drill-down) — filtre + customer_name. */
  customerProducts: protectedProcedure
    .input(nebimCustomerProductsSchema)
    .query(async ({ ctx, input }) => {
      const base = await buildWhere(ctx, input);
      if (!base) return { items: [], net_total: 0 };
      const where: Prisma.NebimSaleLineWhereInput = {
        ...base,
        customer_name: input.customer_name,
      };
      const rows = await ctx.prisma.nebimSaleLine.findMany({
        where,
        orderBy: [{ invoice_date: "desc" }, { invoice_ref: "desc" }, { sort_order: "asc" }],
        take: 500,
        include: { store: { select: { name: true } } },
      });
      const items = rows.map((r) => ({
        id: r.id,
        invoice_ref: r.invoice_ref,
        invoice_date: r.invoice_date,
        store_name: r.store?.name ?? r.store_name_raw,
        is_return: r.is_return,
        item_desc: r.item_desc,
        item_code: r.item_code,
        color_desc: r.color_desc,
        size: r.size,
        salesperson_name: r.salesperson_name,
        qty: Number(r.qty),
        net_amount: r.net_amount == null ? null : Number(r.net_amount),
      }));
      const net_total = items.reduce((s, i) => s + (i.net_amount ?? 0), 0);
      return { items, net_total };
    }),
});
