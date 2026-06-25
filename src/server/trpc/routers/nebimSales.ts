import type { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import {
  nebimSalesFilterSchema,
  nebimAnalizSchema,
  nebimCustomerProductsSchema,
} from "@/lib/zod-schemas/nebim-sales";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";
import {
  buildNebimSalesExcel,
  type NebimSalesExcelRow,
} from "@/server/services/exports/excel/nebim-sales";

/** Outlet ürün birim fiyatları — bu fiyatlarda indirim yapılmaması normaldir. */
const OUTLET_PRICES = [1499.99, 1999.99, 2499.99, 2999.99];

const DISCOUNT_BAND_LABEL: Record<string, string> = {
  discounted: "İndirimli (hepsi)",
  none: "İndirimsiz",
  b1: "%0–10",
  b2: "%10–25",
  b3: "%25–40",
  b4: "%40–60",
  b5: "%60+",
};

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

/** İndirim bandı filtresi → discount_pct where parçası. */
function discountBandWhere(
  band: string | undefined
): Prisma.NebimSaleLineWhereInput {
  switch (band) {
    case "discounted":
      return { discount_pct: { gte: 0.5 } };
    case "none":
      return { discount_pct: { lt: 0.5 } };
    case "b1":
      return { discount_pct: { gte: 0.5, lt: 10 } };
    case "b2":
      return { discount_pct: { gte: 10, lt: 25 } };
    case "b3":
      return { discount_pct: { gte: 25, lt: 40 } };
    case "b4":
      return { discount_pct: { gte: 40, lt: 60 } };
    case "b5":
      return { discount_pct: { gte: 60 } };
    default:
      return {};
  }
}

/** Liste sıralaması → Prisma orderBy. Cursor için her zaman tekil bir bağ-bozucu içerir. */
function buildOrderBy(
  sortBy: string | undefined,
  sortDir: string | undefined
): Prisma.NebimSaleLineOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = sortDir === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "amount":
      return [{ amount_vi: { sort: dir, nulls: "last" } }, { id: "desc" }];
    case "discount":
      return [{ discount_pct: { sort: dir, nulls: "last" } }, { id: "desc" }];
    case "net":
      return [{ net_amount: { sort: dir, nulls: "last" } }, { id: "desc" }];
    case "date":
      // Tarih sıralarken fişi/satırı bir arada tut (tekil sıra).
      return dir === "asc"
        ? [{ invoice_date: "asc" }, { invoice_ref: "asc" }, { sort_order: "asc" }]
        : [{ invoice_date: "desc" }, { invoice_ref: "desc" }, { sort_order: "asc" }];
    default:
      return [{ invoice_date: "desc" }, { invoice_ref: "desc" }, { sort_order: "asc" }];
  }
}

/** İndirim yüzdesi bantları — orijinal (amount_vi) → net (net_amount) farkına göre. */
const DISCOUNT_BUCKETS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: "b0", label: "İndirimsiz", min: -Infinity, max: 0.5 },
  { key: "b1", label: "%0–10", min: 0.5, max: 10 },
  { key: "b2", label: "%10–25", min: 10, max: 25 },
  { key: "b3", label: "%25–40", min: 25, max: 40 },
  { key: "b4", label: "%40–60", min: 40, max: 60 },
  { key: "b5", label: "%60+", min: 60, max: Infinity },
];

type IndirimOzet = {
  orijinal_total: number;
  net_total: number;
  indirim_total: number;
  avg_pct: number;
  lines: number;
  discounted_lines: number;
  buckets: Array<{ key: string; label: string; lines: number; orijinal: number }>;
};

const EMPTY_INDIRIM: IndirimOzet = {
  orijinal_total: 0,
  net_total: 0,
  indirim_total: 0,
  avg_pct: 0,
  lines: 0,
  discounted_lines: 0,
  buckets: DISCOUNT_BUCKETS.map((b) => ({ key: b.key, label: b.label, lines: 0, orijinal: 0 })),
};

/** Satış (iade-olmayan, orijinal>0) satırlarından indirim özeti çıkarır. */
function computeIndirim(rows: Array<{ amount_vi: unknown; net_amount: unknown }>): IndirimOzet {
  const buckets = DISCOUNT_BUCKETS.map((b) => ({ key: b.key, label: b.label, lines: 0, orijinal: 0 }));
  let orijinal_total = 0;
  let net_total = 0;
  let discounted_lines = 0;
  for (const r of rows) {
    const a = Number(r.amount_vi ?? 0);
    if (!(a > 0)) continue;
    const n = Number(r.net_amount ?? 0);
    orijinal_total += a;
    net_total += n;
    const pct = ((a - n) / a) * 100;
    if (pct >= 0.5) discounted_lines += 1;
    const bi = DISCOUNT_BUCKETS.findIndex((b) => pct >= b.min && pct < b.max);
    const slot = buckets[bi >= 0 ? bi : 0]!;
    slot.lines += 1;
    slot.orijinal += a;
  }
  const indirim_total = orijinal_total - net_total;
  return {
    orijinal_total,
    net_total,
    indirim_total,
    avg_pct: orijinal_total > 0 ? (indirim_total / orijinal_total) * 100 : 0,
    lines: rows.length,
    discounted_lines,
    buckets,
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
        ...discountBandWhere(input.discount_band),
      };

      const rows = await ctx.prisma.nebimSaleLine.findMany({
        where,
        orderBy: buildOrderBy(input.sort_by, input.sort_dir),
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
        amount_vi: r.amount_vi == null ? null : Number(r.amount_vi),
        net_amount: r.net_amount == null ? null : Number(r.net_amount),
        invoice_note: r.invoice_note,
        mgmt_note: r.mgmt_note,
        discount_reason: r.discount_reason,
        campaign: r.campaign,
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
   * Şüpheli satışlar — yönetim onayı OLMAYAN (mgmt_note + discount_reason yok),
   * iade-olmayan satışlardan kampanya kuralına uymayanlar:
   *   A) indirim var ama ~%20 ve ~%50 değil (20/50 dışı), veya
   *   B) hiç indirim yok ve birim fiyat outlet fiyatı değil.
   * Manuel kontrol/sorgulama içindir (yanlış fiyat, fazla para, yetkisiz indirim).
   */
  suspicious: protectedProcedure
    .input(nebimSalesFilterSchema)
    .query(async ({ ctx, input }) => {
      const empty = {
        items: [] as unknown[],
        nextCursor: null as string | null,
        summary: { total: 0, weird: 0, fullprice: 0 },
        by_salesperson: [] as Array<{ name: string; count: number }>,
      };
      let allowedStoreIds: string[] | null = null;
      if (!isAdmin(ctx.user)) {
        allowedStoreIds = await getAccessibleStoreIds(ctx.user);
        if (allowedStoreIds.length === 0) return empty;
      }
      let storeFilter: string[] | undefined;
      if (input.store_id) storeFilter = [input.store_id];
      else if (allowedStoreIds) storeFilter = allowedStoreIds;

      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (input.date_from) dateFilter.gte = new Date(`${input.date_from}T00:00:00.000Z`);
      if (input.date_to) dateFilter.lte = new Date(`${input.date_to}T00:00:00.000Z`);

      // Yönetim onayı olmayan, iade-olmayan satış tabanı
      const base: Prisma.NebimSaleLineWhereInput = {
        ...(storeFilter ? { store_id: { in: storeFilter } } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { invoice_date: dateFilter } : {}),
        is_return: false,
        mgmt_note: null,
        discount_reason: null,
      };

      // A) indirimli ama kabul edilen kampanya oranları (~%20, ~%40, ~%50; ±1.5)
      // dışında. Bu bantların dışındaki her indirim şüpheli.
      const weirdOr: Prisma.NebimSaleLineWhereInput[] = [
        { discount_pct: { gte: 0.5, lt: 18.5 } }, // %20 altı
        { discount_pct: { gt: 21.5, lt: 38.5 } }, // %20–%40 arası
        { discount_pct: { gt: 41.5, lt: 48.5 } }, // %40–%50 arası
        { discount_pct: { gt: 51.5 } }, // %50 üstü
      ];
      // B) tam fiyat (indirim yok) ama birim fiyat outlet değil
      const fullpriceCond: Prisma.NebimSaleLineWhereInput = {
        discount_pct: { lt: 0.5 },
        price: { notIn: OUTLET_PRICES },
      };
      const where: Prisma.NebimSaleLineWhereInput = {
        ...base,
        OR: [...weirdOr, fullpriceCond],
      };

      const [rows, weird, fullprice, bySalesRaw] = await Promise.all([
        ctx.prisma.nebimSaleLine.findMany({
          where,
          orderBy: [
            { invoice_date: "desc" },
            { invoice_ref: "desc" },
            { sort_order: "asc" },
          ],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { store: { select: { name: true } } },
        }),
        ctx.prisma.nebimSaleLine.count({ where: { ...base, OR: weirdOr } }),
        ctx.prisma.nebimSaleLine.count({ where: { ...base, ...fullpriceCond } }),
        ctx.prisma.nebimSaleLine.groupBy({
          by: ["salesperson_name"],
          where,
          _count: { _all: true },
        }),
      ]);

      const hasMore = rows.length > input.limit;
      const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? trimmed[trimmed.length - 1]!.id : null;

      const items = trimmed.map((r) => {
        const pct = r.discount_pct == null ? null : Number(r.discount_pct);
        return {
          id: r.id,
          invoice_ref: r.invoice_ref,
          invoice_date: r.invoice_date,
          store_name: r.store?.name ?? r.store_name_raw,
          item_code: r.item_code,
          item_desc: r.item_desc,
          color_desc: r.color_desc,
          size: r.size,
          salesperson_name: r.salesperson_name,
          customer_name: r.customer_name,
          campaign: r.campaign,
          price: r.price == null ? null : Number(r.price),
          amount_vi: r.amount_vi == null ? null : Number(r.amount_vi),
          net_amount: r.net_amount == null ? null : Number(r.net_amount),
          discount_pct: pct,
          reason: pct != null && pct < 0.5 ? "fullprice" : "weird",
        };
      });

      const by_salesperson = bySalesRaw
        .map((g) => ({ name: g.salesperson_name ?? "—", count: g._count._all }))
        .sort((a, b) => b.count - a.count);

      return {
        items,
        nextCursor,
        summary: { total: weird + fullprice, weird, fullprice },
        by_salesperson,
      };
    }),

  /** Filtreli satış listesinin Excel (.xlsx) export'u — tüm sütunlar. */
  exportExcel: protectedProcedure
    .input(nebimSalesFilterSchema)
    .mutation(async ({ ctx, input }) => {
      let allowedStoreIds: string[] | null = null;
      if (!isAdmin(ctx.user)) {
        allowedStoreIds = await getAccessibleStoreIds(ctx.user);
        if (allowedStoreIds.length === 0) throw new Error("Erişebileceğin mağaza yok");
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
        ...discountBandWhere(input.discount_band),
      };

      const rows = await ctx.prisma.nebimSaleLine.findMany({
        where,
        orderBy: [
          { invoice_date: "desc" },
          { invoice_ref: "desc" },
          { sort_order: "asc" },
        ],
        take: 20000,
        include: { store: { select: { name: true } } },
      });

      const data: NebimSalesExcelRow[] = rows.map((r) => ({
        tarih: r.invoice_date,
        fis: r.invoice_ref,
        magaza: r.store?.name ?? r.store_name_raw ?? "",
        urun: r.item_desc ?? r.item_code ?? "",
        kod: r.item_code ?? "",
        renk_beden: [r.color_desc, r.size].filter(Boolean).join(" / "),
        satici: r.salesperson_name ?? "",
        musteri: r.customer_name ?? "",
        odeme: r.payment_type ?? "",
        kart: r.card_type ?? "",
        adet: Number(r.qty),
        orijinal: r.amount_vi == null ? null : Number(r.amount_vi),
        indirim_pct: r.discount_pct == null ? null : Number(r.discount_pct),
        net: r.net_amount == null ? null : Number(r.net_amount),
        kampanya: r.campaign ?? "",
        iskonto_nedeni: r.discount_reason ?? "",
        yonetim_aciklamasi: r.mgmt_note ?? "",
        fis_notu: r.invoice_note ?? "",
        iade: r.is_return ? "İade" : "",
      }));

      const range =
        input.date_from && input.date_to
          ? input.date_from === input.date_to
            ? input.date_from
            : `${input.date_from} – ${input.date_to}`
          : "tüm tarihler";
      const parts = [`${data.length} satır`];
      if (input.only_returns) parts.push("sadece iadeler");
      if (input.discount_band && DISCOUNT_BAND_LABEL[input.discount_band]) {
        parts.push(`indirim: ${DISCOUNT_BAND_LABEL[input.discount_band]}`);
      }

      return buildNebimSalesExcel({
        rows: data,
        subtitle: range,
        filterSummary: parts.join(" · "),
        fileTag: (input.date_from ?? "tum").replace(/-/g, ""),
      });
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
        by_campaign: [] as Array<{ label: string; net: number; lines: number; invoices: number }>,
        by_reason: [] as Array<{ label: string; net: number; lines: number; invoices: number }>,
        manuel: {
          lines: 0,
          invoices: 0,
          net: 0,
          top: [] as Array<{ note: string; net: number; lines: number }>,
        },
        indirim: EMPTY_INDIRIM,
      };
      if (!where) return empty;

      const manuelWhere: Prisma.NebimSaleLineWhereInput = { ...where, mgmt_note: { not: null } };

      // İndirim = sadece satış satırları (iade hariç, orijinal tutar > 0)
      const discWhere: Prisma.NebimSaleLineWhereInput = {
        ...where,
        is_return: false,
        amount_vi: { gt: 0 },
      };
      const campWhere: Prisma.NebimSaleLineWhereInput = { ...where, campaign: { not: null } };
      const reasonWhere: Prisma.NebimSaleLineWhereInput = { ...where, discount_reason: { not: null } };

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
        discRows,
        byCampRaw,
        campInv,
        byReasonRaw,
        reasonInv,
        manuelAgg,
        manuelInv,
        byMgmtRaw,
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
        ctx.prisma.nebimSaleLine.findMany({ where: discWhere, select: { amount_vi: true, net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["campaign"], where: campWhere, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["campaign", "invoice_ref"], where: campWhere }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["discount_reason"], where: reasonWhere, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["discount_reason", "invoice_ref"], where: reasonWhere }),
        ctx.prisma.nebimSaleLine.aggregate({ where: manuelWhere, _count: { _all: true }, _sum: { net_amount: true } }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["invoice_ref"], where: manuelWhere }),
        ctx.prisma.nebimSaleLine.groupBy({ by: ["mgmt_note"], where: manuelWhere, _count: { _all: true }, _sum: { net_amount: true } }),
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

      // Kampanya ve İskonto nedeni kırılımları (aynı "etiket bazında net+satır+fiş" deseni)
      const fisCountBy = <K extends string>(
        groups: Array<Record<K, string | null> & { invoice_ref: string }>,
        key: K
      ) => {
        const m = new Map<string, number>();
        for (const g of groups) {
          const k = g[key];
          if (k == null) continue;
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
      };
      const campFis = fisCountBy(campInv, "campaign");
      const by_campaign = byCampRaw
        .filter((g) => g.campaign != null)
        .map((g) => ({
          label: g.campaign as string,
          net: Number(g._sum.net_amount ?? 0),
          lines: g._count._all,
          invoices: campFis.get(g.campaign as string) ?? 0,
        }))
        .sort((a, b) => b.net - a.net);

      const reasonFis = fisCountBy(reasonInv, "discount_reason");
      const by_reason = byReasonRaw
        .filter((g) => g.discount_reason != null)
        .map((g) => ({
          label: g.discount_reason as string,
          net: Number(g._sum.net_amount ?? 0),
          lines: g._count._all,
          invoices: reasonFis.get(g.discount_reason as string) ?? 0,
        }))
        .sort((a, b) => b.net - a.net);

      // Manuel iskonto (yönetim açıklamalı) özeti + en sık açıklamalar
      const manuel = {
        lines: manuelAgg._count._all,
        invoices: manuelInv.length,
        net: Number(manuelAgg._sum.net_amount ?? 0),
        top: byMgmtRaw
          .filter((g) => g.mgmt_note != null)
          .map((g) => ({
            note: g.mgmt_note as string,
            net: Number(g._sum.net_amount ?? 0),
            lines: g._count._all,
          }))
          .sort((a, b) => b.net - a.net)
          .slice(0, 100),
      };

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
        by_campaign,
        by_reason,
        manuel,
        indirim: computeIndirim(discRows),
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
