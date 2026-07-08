import type { Prisma, PrismaClient } from "@prisma/client";
import { router, adminProcedure } from "../trpc";
import {
  nebimSalesFilterSchema,
  nebimAnalizSchema,
  nebimCustomerProductsSchema,
  nebimCustomerDetailSchema,
  nebimStoreTargetSchema,
} from "@/lib/zod-schemas/nebim-sales";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";
import {
  buildNebimSalesExcel,
  type NebimSalesExcelRow,
} from "@/server/services/exports/excel/nebim-sales";
import { buildNebimCustomersExcel } from "@/server/services/exports/excel/nebim-customers";

/** Outlet ürün birim fiyatları — bu fiyatlarda indirim yapılmaması normaldir. */
const OUTLET_PRICES = [1499.99, 1999.99, 2499.99, 2999.99];

/**
 * Sadakat bantları — dönem net harcamasına göre. İlk kalibrasyon; ileride
 * kredi-puanı sistemine evrilebilir (eşikleri buradan ayarla).
 */
export const LOYALTY_TIERS = [
  { key: "vip", label: "VIP", min: 100_000 },
  { key: "gold", label: "Altın", min: 50_000 },
  { key: "silver", label: "Gümüş", min: 25_000 },
  { key: "bronze", label: "Bronz", min: 10_000 },
] as const;
export type LoyaltyTierKey = (typeof LOYALTY_TIERS)[number]["key"];

function tierFor(net: number): LoyaltyTierKey | null {
  for (const t of LOYALTY_TIERS) if (net >= t.min) return t.key;
  return null;
}

/**
 * Jenerik/ortak müşteri kartları — gerçek kişi değil (mağazaların turist
 * kartları: "YABANCI GİRNE", "MAĞUSA YABANCI 2025", "YABANCİ"...). Müşteri
 * analizinden hariç tutulur; net'leri KPI'da ayrı gösterilir.
 * DİKKAT: "KART"/"GENEL" gibi kalıplar EKLENMEZ — gerçek soyadlarla
 * (Kartal, Kartopu, Kart) ve kurumlarla (Polis Genel Müdürlüğü) çakışır.
 */
const GENERIC_CUSTOMER_TERMS = ["yabanci"];

function isGenericCustomer(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/i̇/g, "i");
  return GENERIC_CUSTOMER_TERMS.some((t) => n.includes(t));
}

export type NebimCustomerRow = {
  code: string | null;
  name: string;
  net: number;
  invoices: number;
  units: number;
  lines: number;
  avg_basket: number;
  first_date: string; // dönem içi ilk alışveriş
  last_date: string;
  first_ever: string; // tüm zaman ilk (yeni-müşteri tespiti)
  is_new: boolean;
  tier: LoyaltyTierKey | null;
};

export type NebimCustomersResult = {
  kpi: {
    customers: number;
    net_total: number;
    new_customers: number;
    repeat_pct: number;
    avg_spend: number;
    anonymous_net: number;
    /** Jenerik/turist kartlarının (hariç tutulan) dönem net'i + kart sayısı. */
    generic_net: number;
    generic_count: number;
  };
  rows: NebimCustomerRow[];
  total_customers: number;
};

/**
 * MÜŞTERİ ANALİZİ hesabı — sadık / yüksek harcamalı müşteri takibi.
 * Dönem içi net harcamaya göre sıralı müşteri listesi (iadeler net'e dahil,
 * yani iade eden müşterinin katkısı şişmez) + KPI'lar + sadakat bandı.
 * "Yeni müşteri" = ilk alışverişi bu dönemde olan (tüm-zaman min tarihe göre).
 * Hem customers query hem exportCustomers mutation buradan beslenir.
 */
async function computeCustomers(
  ctx: { user: unknown; prisma: PrismaClient },
  input: { store_id?: string; date_from?: string; date_to?: string }
): Promise<NebimCustomersResult> {
  const empty: NebimCustomersResult = {
    kpi: {
      customers: 0, net_total: 0, new_customers: 0,
      repeat_pct: 0, avg_spend: 0, anonymous_net: 0,
      generic_net: 0, generic_count: 0,
    },
    rows: [],
    total_customers: 0,
  };
  const base = await buildWhere(ctx, {
    store_id: input.store_id,
    date_from: input.date_from,
    date_to: input.date_to,
  });
  if (!base) return empty;
  const named: Prisma.NebimSaleLineWhereInput = {
    ...base,
    customer_name: { not: null },
  };

  const [groups, invGroups, firstEverGroups, anonAgg] = await Promise.all([
    ctx.prisma.nebimSaleLine.groupBy({
      by: ["customer_code", "customer_name"],
      where: named,
      _sum: { net_amount: true, qty: true },
      _count: { _all: true },
      _min: { invoice_date: true },
      _max: { invoice_date: true },
    }),
    ctx.prisma.nebimSaleLine.groupBy({
      by: ["customer_code", "customer_name", "invoice_ref"],
      where: named,
    }),
    // Tüm-zaman ilk alışveriş (dönem filtresi YOK; mağaza kapsamı korunur)
    ctx.prisma.nebimSaleLine.groupBy({
      by: ["customer_code", "customer_name"],
      where: {
        ...(base.store_id ? { store_id: base.store_id } : {}),
        customer_name: { not: null },
      },
      _min: { invoice_date: true },
    }),
    ctx.prisma.nebimSaleLine.aggregate({
      where: { ...base, customer_name: null },
      _sum: { net_amount: true },
    }),
  ]);

  const key = (c: string | null, n: string | null) => `${c ?? ""}|${n ?? ""}`;
  const invCount = new Map<string, number>();
  for (const g of invGroups) {
    const k = key(g.customer_code, g.customer_name);
    invCount.set(k, (invCount.get(k) ?? 0) + 1);
  }
  const firstEver = new Map<string, Date>();
  for (const g of firstEverGroups) {
    const d = g._min.invoice_date;
    if (d) firstEver.set(key(g.customer_code, g.customer_name), d);
  }

  const periodStart = input.date_from
    ? new Date(`${input.date_from}T00:00:00.000Z`)
    : null;
  const iso = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : "";

  let netTotal = 0, newCustomers = 0, repeat = 0;
  let genericNet = 0, genericCount = 0;
  const rows: NebimCustomerRow[] = [];
  for (const g of groups) {
    const net = Number(g._sum.net_amount ?? 0);
    // Jenerik/turist kartları gerçek kişi değil — listeden ve KPI'lardan hariç.
    if (isGenericCustomer(g.customer_name)) {
      genericNet += net;
      genericCount += 1;
      continue;
    }
    const k = key(g.customer_code, g.customer_name);
    const invoices = invCount.get(k) ?? 0;
    const ever = firstEver.get(k) ?? null;
    // Dönem başlangıcı yoksa (tüm zaman) "yeni" ayrımı anlamsız — false.
    const isNew = periodStart ? (ever ? ever >= periodStart : true) : false;
    netTotal += net;
    if (isNew) newCustomers += 1;
    if (invoices >= 2) repeat += 1;
    rows.push({
      code: g.customer_code,
      name: g.customer_name ?? "—",
      net,
      invoices,
      units: Number(g._sum.qty ?? 0),
      lines: g._count._all,
      avg_basket: invoices ? net / invoices : 0,
      first_date: iso(g._min.invoice_date),
      last_date: iso(g._max.invoice_date),
      first_ever: iso(ever),
      is_new: isNew,
      tier: tierFor(net),
    });
  }
  rows.sort((a, b) => b.net - a.net);

  const count = rows.length;
  return {
    kpi: {
      customers: count,
      net_total: netTotal,
      new_customers: newCustomers,
      repeat_pct: count ? (repeat / count) * 100 : 0,
      avg_spend: count ? netTotal / count : 0,
      anonymous_net: Number(anonAgg._sum.net_amount ?? 0),
      generic_net: genericNet,
      generic_count: genericCount,
    },
    rows: rows.slice(0, 100),
    total_customers: count,
  };
}

/** ~%40 bandı (±1.5). Genelde kabul edilir AMA aşağıdaki dönemlerde şüpheli. */
const FORTY_BAND = { gte: 38.5, lte: 41.5 } as const;

/** Ceket için kabul edilen indirim aralığı: ~%40 (1. ceket) – ~%50 (2. ceket), dip iskonto payı dahil. */
const JACKET_OK_RANGE = { gte: 38.5, lte: 51.5 } as const;
/** Ceket alt fiyat eşiği — ucuz isim-only bakım ürünü/çorap ceket sayılmasın. */
const JACKET_MIN_PRICE = 1000;

/**
 * Bakım/aksesuar ürünleri — tam fiyat satılması NORMALDİR (indirim beklenmez),
 * "tam fiyat şüphelisi"nden hariç. BLİNK (temizlik/bakım), KOKU TOPU (koku) vb.
 */
const CARE_TERMS = ["BLİNK", "BLINK", "KOKU"];

/**
 * Kategori kelimeleri — bunlardan birini içeren açıklama "kategori ürünü"dür.
 * HİÇBİRİNİ içermeyen (sadece model adı: NITA/KYLIE/LYDIA…) = CEKET.
 */
const CATEGORY_WORDS = [
  "KADIN", "ERKEK", "ÇOCUK", "UNISEX", "BLİNK", "BLINK", "AYAKKABI",
  "SANDALET", "ÇANTA", "TERLİK", "CÜZDAN", "KEMER", "KARTLIK", "ÇİZME",
  "LOAFER", "BABET", "MOKASEN", "SNEAKER", "ANAHTAR", "ŞAL", "ATKI",
  "ELDİVEN", "SÜNGER", "SPREY", "BOT",
];

/**
 * Deri giysi (ceket) ürün-kodu deseni: sezon harfi (W/S) + giysi tipi (GD/GE).
 * Örn. 20WGE5886NC, 22SGD5986U4. (FD/FT = ayakkabı.)
 */
const GARMENT_CODE_PREFIXES = ["WGD", "SGD", "WGE", "SGE"];

/** item_code deri-giysi (ceket) kodu mu? */
function isGarmentCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const u = code.toLocaleUpperCase("tr");
  return GARMENT_CODE_PREFIXES.some((p) => u.includes(p));
}

/** item_desc kategori kelimesi içermiyor mu? (içermiyorsa isim-only = ceket adayı) */
function isNameOnly(desc: string | null | undefined): boolean {
  if (!desc || !desc.trim()) return false;
  const u = desc.toLocaleUpperCase("tr");
  return !CATEGORY_WORDS.some((w) => u.includes(w));
}

/** Satır ceket (deri giysi) mi? isim-only VEYA GD/GE kodu. */
function isJacketRow(desc: string | null | undefined, code: string | null | undefined): boolean {
  return isNameOnly(desc) || isGarmentCode(code);
}
/**
 * %40 kampanyasının OLMADIĞI dönemler → bu dönemlerdeki ~%40 indirim şüpheli.
 * Haziran 2026: kampanya 20/50, %40 yok. Yeni dönem gerekirse buraya ekle.
 */
const NO_40_PERIODS: Array<{ gte: Date; lt: Date }> = [
  { gte: new Date("2026-06-01T00:00:00.000Z"), lt: new Date("2026-07-01T00:00:00.000Z") },
];

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
  list: adminProcedure
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
  suspicious: adminProcedure
    .input(nebimSalesFilterSchema)
    .query(async ({ ctx, input }) => {
      const empty = {
        items: [] as unknown[],
        nextCursor: null as string | null,
        summary: { total: 0, weird: 0, fullprice: 0, june40: 0, jacket: 0 },
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

      // Kategori ürünü mü? (kategori kelimesi içerir). İçermeyen = ceket (isim-only).
      const categoryWhere: Prisma.NebimSaleLineWhereInput = {
        OR: CATEGORY_WORDS.map((w) => ({
          item_desc: { contains: w, mode: "insensitive" },
        })),
      };
      const careWhere: Prisma.NebimSaleLineWhereInput = {
        OR: CARE_TERMS.map((t) => ({ item_desc: { contains: t, mode: "insensitive" } })),
      };

      // İndirim ~%20/%40/%50 bandı dışı aralıklar (boşluklar)
      const weirdOr: Prisma.NebimSaleLineWhereInput[] = [
        { discount_pct: { gte: 0.5, lt: 18.5 } }, // %20 altı
        { discount_pct: { gt: 21.5, lt: 38.5 } }, // %20–%40 arası
        { discount_pct: { gt: 41.5, lt: 48.5 } }, // %40–%50 arası
        { discount_pct: { gt: 51.5 } }, // %50 üstü
      ];

      // CEKET (deri giysi) kimliği: isim-only (≥1000₺, ucuz bakım/aksesuar değil)
      // VEYA GD/GE ürün kodu.
      const garmentCodeWhere: Prisma.NebimSaleLineWhereInput = {
        OR: GARMENT_CODE_PREFIXES.map((p) => ({
          item_code: { contains: p, mode: "insensitive" },
        })),
      };
      const jacketIdentity: Prisma.NebimSaleLineWhereInput = {
        OR: [
          {
            AND: [
              { item_desc: { not: null } },
              { NOT: categoryWhere },
              { price: { gte: JACKET_MIN_PRICE } },
            ],
          },
          garmentCodeWhere,
        ],
      };
      // A) CEKET ama indirim %40–%50 aralığı dışı (1.ceket %40, 2.ceket %50)
      const jacketCond: Prisma.NebimSaleLineWhereInput = {
        AND: [jacketIdentity, { NOT: { discount_pct: JACKET_OK_RANGE } }],
      };
      // B) Kategori ürün, indirimli ama 20/40/50 dışı
      const weirdCond: Prisma.NebimSaleLineWhereInput = {
        AND: [categoryWhere, { OR: weirdOr }],
      };
      // C) Kategori ürün, tam fiyat ama outlet değil, bakım/aksesuar (BLİNK/KOKU) değil
      const fullpriceCond: Prisma.NebimSaleLineWhereInput = {
        AND: [
          categoryWhere,
          { NOT: careWhere },
          { discount_pct: { lt: 0.5 } },
          { price: { notIn: OUTLET_PRICES } },
        ],
      };
      // D) Kategori ürün, %40 kampanyasının olmadığı dönemde (Haziran) ~%40 indirim
      const june40Conds: Prisma.NebimSaleLineWhereInput[] = NO_40_PERIODS.map((p) => ({
        AND: [categoryWhere, { discount_pct: FORTY_BAND }, { invoice_date: p }],
      }));

      const where: Prisma.NebimSaleLineWhereInput = {
        ...base,
        OR: [jacketCond, weirdCond, fullpriceCond, ...june40Conds],
      };

      const [rows, weird, fullprice, june40, jacket, bySalesRaw] = await Promise.all([
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
        ctx.prisma.nebimSaleLine.count({ where: { ...base, ...weirdCond } }),
        ctx.prisma.nebimSaleLine.count({ where: { ...base, ...fullpriceCond } }),
        ctx.prisma.nebimSaleLine.count({ where: { ...base, OR: june40Conds } }),
        ctx.prisma.nebimSaleLine.count({ where: { ...base, ...jacketCond } }),
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
          reason: isJacketRow(r.item_desc, r.item_code)
            ? "jacket"
            : pct != null && pct >= 38.5 && pct <= 41.5
              ? "june40"
              : pct == null || pct < 0.5
                ? "fullprice"
                : "weird",
        };
      });

      const by_salesperson = bySalesRaw
        .map((g) => ({ name: g.salesperson_name ?? "—", count: g._count._all }))
        .sort((a, b) => b.count - a.count);

      return {
        items,
        nextCursor,
        summary: {
          total: weird + fullprice + june40 + jacket,
          weird,
          fullprice,
          june40,
          jacket,
        },
        by_salesperson,
      };
    }),

  /** Filtreli satış listesinin Excel (.xlsx) export'u — tüm sütunlar. */
  exportExcel: adminProcedure
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
  analiz: adminProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => {
      const where = await buildWhere(ctx, input);
      const empty = {
        kpi: { net_total: 0, invoices: 0, lines: 0, returns_total: 0, returns_count: 0 },
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
        retAgg,
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
        // İadeler — net_amount negatif; net toplamdan düşülür. Ayrı gösterilir.
        ctx.prisma.nebimSaleLine.aggregate({ where: { ...where, is_return: true }, _count: { _all: true }, _sum: { net_amount: true } }),
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
          returns_total: Number(retAgg._sum.net_amount ?? 0),
          returns_count: retAgg._count._all,
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

  /**
   * Çalışan Satış KPI — satıcı bazında performans (iade hariç / brüt).
   * UPT = adet/işlem, SEPET = net/işlem, TEKİL = tek-ürünlü (qty=1) işlem %.
   * (REEL UPT hesaplanmaz — dış sistemde.)
   */
  staffKpi: adminProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => {
      const empty = {
        total: { net: 0, invoices: 0, units: 0, upt: 0, sepet: 0, tekil_pct: 0 },
        rows: [] as Array<{
          name: string;
          net: number;
          net_pct: number;
          invoices: number;
          units: number;
          upt: number;
          sepet: number;
          tekil_pct: number;
        }>,
      };
      const base = await buildWhere(ctx, input);
      if (!base) return empty;

      const rows = await ctx.prisma.nebimSaleLine.findMany({
        where: { ...base, is_return: false },
        select: { salesperson_name: true, invoice_ref: true, qty: true, net_amount: true },
      });

      // Satıcı → { net, units, fiş başına qty toplamı }
      const m = new Map<string, { net: number; units: number; inv: Map<string, number> }>();
      for (const r of rows) {
        const s = r.salesperson_name ?? "—";
        let o = m.get(s);
        if (!o) {
          o = { net: 0, units: 0, inv: new Map() };
          m.set(s, o);
        }
        const q = Number(r.qty);
        o.net += Number(r.net_amount ?? 0);
        o.units += q;
        o.inv.set(r.invoice_ref, (o.inv.get(r.invoice_ref) ?? 0) + q);
      }

      let tNet = 0;
      let tUnits = 0;
      let tInv = 0;
      let tTekil = 0;
      const out = Array.from(m.entries()).map(([name, o]) => {
        const invoices = o.inv.size;
        let tekil = 0;
        for (const q of Array.from(o.inv.values())) if (Math.round(q) === 1) tekil += 1;
        tNet += o.net;
        tUnits += o.units;
        tInv += invoices;
        tTekil += tekil;
        return {
          name,
          net: o.net,
          invoices,
          units: o.units,
          upt: invoices ? o.units / invoices : 0,
          sepet: invoices ? o.net / invoices : 0,
          tekil_pct: invoices ? (tekil / invoices) * 100 : 0,
        };
      });

      const totalNet = tNet || 1;
      const rowsOut = out
        .map((r) => ({ ...r, net_pct: (r.net / totalNet) * 100 }))
        .sort((a, b) => b.net - a.net);

      return {
        total: {
          net: tNet,
          invoices: tInv,
          units: tUnits,
          upt: tInv ? tUnits / tInv : 0,
          sepet: tInv ? tNet / tInv : 0,
          tekil_pct: tInv ? (tTekil / tInv) * 100 : 0,
        },
        rows: rowsOut,
      };
    }),

  /**
   * OUTLET analizi — HİBRİT tespit (barkod backfill'i sonrası):
   * - KESİN: satırın barkodu OutletStockItem sayımında ∧ outlet fiyatında
   *   satılmış (kategori şartı yok — sayım LOAFER/BABET gibi tanım-dışıları
   *   da kanıtlar). Sayım "rafta kalanlar"ı gösterir; outlet fiyat şartı,
   *   ürünün outlet'e alınmadan ÖNCEKİ normal/kampanyalı satışlarını eler.
   * - MUHTEMEL: eski fiyat+kategori kuralı (ayakkabı/terlik/sandalet, sabit
   *   fiyat) ∧ sayımda yok — satılıp tükenen model olabilir.
   * Kural-dışı satışlar aynen: (a) kampanya sızması (indirimli + yönetim izi
   * yok), (b) Girne satışı (reyon yok; sayım eşleşmesi = kesin kanıt).
   * Yönetim dokunuşlu indirimler NORMALDİR — ihlal sayılmaz.
   */
  outlet: adminProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => {
      type Cell = { net: number; count: number };
      type LeakRow = {
        date: string; store: string; ref: string; code: string | null;
        desc: string | null; price: number; sold: number; disc_pct: number;
        campaign: string | null; salesperson: string | null; stock_match: boolean;
      };
      type GirneRow = {
        date: string; ref: string; code: string | null; desc: string | null;
        price: number; sold: number; disc_pct: number; overlap: boolean;
        stock_match: boolean;
      };
      const empty = {
        summary: {
          net_total: 0, tx_count: 0, discount_total: 0,
          returns_total: 0, returns_count: 0, leak_loss: 0,
          certain_tx: 0, certain_net: 0, probable_tx: 0, probable_net: 0,
        },
        stores: [] as string[],
        months: [] as Array<{
          month: string; label: string;
          cells: Record<string, Cell>; total: Cell;
        }>,
        store_totals: {} as Record<string, Cell>,
        leaks: [] as LeakRow[],
        girne: [] as GirneRow[],
      };
      const base = await buildWhere(ctx, {
        store_id: input.store_id,
        date_from: input.date_from,
        date_to: input.date_to,
      });
      if (!base) return empty;

      // Outlet ürün tanımı: ayakkabı/terlik/sandalet (kategori kuralı) VEYA
      // barkodu fiziksel sayımda olan ürün (kesin kimlik — loafer/babet dahil).
      const FOOT_OR: Prisma.NebimSaleLineWhereInput[] = [
        { item_desc: { contains: "AYAKKABI", mode: "insensitive" } },
        { item_desc: { contains: "TERLİK", mode: "insensitive" } },
        { item_desc: { contains: "TERLIK", mode: "insensitive" } },
        { item_desc: { contains: "SANDALET", mode: "insensitive" } },
      ];

      const stockItems = await ctx.prisma.outletStockItem.findMany({
        select: { barcode: true },
      });
      const stockBarcodes = Array.from(new Set(stockItems.map((s) => s.barcode)));
      const stockSet = new Set(stockBarcodes);

      const [rows, storeRows] = await Promise.all([
        ctx.prisma.nebimSaleLine.findMany({
          where: {
            AND: [
              base,
              { price: { in: OUTLET_PRICES } },
              {
                OR: [
                  ...FOOT_OR,
                  ...(stockBarcodes.length > 0
                    ? [{ barcode: { in: stockBarcodes } }]
                    : []),
                ],
              },
            ],
          },
          select: {
            store_id: true, invoice_date: true, invoice_ref: true, item_code: true,
            item_desc: true, qty: true, price: true, amount_vi: true, net_amount: true,
            is_return: true, mgmt_note: true, discount_reason: true, campaign: true,
            salesperson_name: true, barcode: true,
          },
          orderBy: [{ invoice_date: "asc" }, { invoice_ref: "asc" }],
        }),
        ctx.prisma.store.findMany({ select: { id: true, name: true } }),
      ]);

      const storeName = new Map(storeRows.map((s) => [s.id, s.name.replace(/^DERIMOD\s*/i, "")]));
      const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i");
      const isGirneStore = (id: string | null) => norm(storeName.get(id ?? "") ?? "").includes("girne");

      // Girne çapraz kontrolü: L/M outlet reyonunda görülen ürün kodları
      const lmCodes = new Set<string>();
      for (const r of rows) {
        if (!r.is_return && !isGirneStore(r.store_id) && r.item_code) lmCodes.add(r.item_code);
      }

      const MONTH_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
      const matrix = new Map<string, Map<string, Cell>>();
      const storeTotals = new Map<string, Cell>();
      const seenStores = new Set<string>();
      let netTotal = 0, txCount = 0, discountTotal = 0;
      let returnsTotal = 0, returnsCount = 0, leakLoss = 0;
      let certainTx = 0, certainNet = 0, probableTx = 0, probableNet = 0;
      const leaks: LeakRow[] = [];
      const girne: GirneRow[] = [];

      for (const r of rows) {
        const sName = storeName.get(r.store_id ?? "") ?? "?";
        const net = Number(r.net_amount ?? 0);
        const avi = Number(r.amount_vi ?? 0);
        const qty = Math.abs(Number(r.qty ?? 1)) || 1;
        const price = Number(r.price ?? 0);
        const stockMatch = r.barcode != null && stockSet.has(r.barcode);
        if (r.is_return) {
          returnsTotal += net; // iade net'i zaten negatif
          returnsCount += 1;
          continue;
        }
        if (stockMatch) { certainTx += 1; certainNet += net; }
        else { probableTx += 1; probableNet += net; }
        const month = r.invoice_date.toISOString().slice(0, 7);
        let mRow = matrix.get(month);
        if (!mRow) { mRow = new Map(); matrix.set(month, mRow); }
        const cell = mRow.get(sName) ?? { net: 0, count: 0 };
        cell.net += net; cell.count += 1;
        mRow.set(sName, cell);
        const st = storeTotals.get(sName) ?? { net: 0, count: 0 };
        st.net += net; st.count += 1;
        storeTotals.set(sName, st);
        seenStores.add(sName);
        netTotal += net; txCount += 1;
        const disc = avi - net;
        if (disc > 0.01) discountTotal += disc;

        const mgmt = r.mgmt_note != null || r.discount_reason != null;
        const common = {
          date: r.invoice_date.toISOString().slice(0, 10),
          ref: r.invoice_ref,
          code: r.item_code,
          desc: r.item_desc,
          price,
          sold: Math.abs(net) / qty,
          disc_pct: avi > 0 ? (disc / avi) * 100 : 0,
          stock_match: stockMatch,
        };
        if (isGirneStore(r.store_id)) {
          girne.push({ ...common, overlap: r.item_code != null && lmCodes.has(r.item_code) });
        } else if (disc > 0.01 && !mgmt) {
          leaks.push({
            ...common,
            store: sName,
            campaign: r.campaign,
            salesperson: r.salesperson_name,
          });
          leakLoss += disc;
        }
      }

      // Sütun sırası: Lefkoşa, Girne, Mağusa, diğerleri
      const orderKey = (s: string) => {
        const n = norm(s);
        if (n.includes("lefkosa")) return 0;
        if (n.includes("girne")) return 1;
        if (n.includes("magusa")) return 2;
        return 3;
      };
      const stores = Array.from(seenStores).sort((a, b) => orderKey(a) - orderKey(b));

      const months = Array.from(matrix.keys())
        .sort()
        .reverse() // yeni ay üstte
        .map((month) => {
          const mRow = matrix.get(month)!;
          const cells: Record<string, Cell> = {};
          let tNet = 0, tCount = 0;
          for (const s of stores) {
            const c = mRow.get(s);
            if (c) { cells[s] = c; tNet += c.net; tCount += c.count; }
          }
          const [y, m] = month.split("-");
          return {
            month,
            label: `${MONTH_TR[Number(m) - 1]} ${y}`,
            cells,
            total: { net: tNet, count: tCount },
          };
        });

      return {
        summary: {
          net_total: netTotal, tx_count: txCount, discount_total: discountTotal,
          returns_total: returnsTotal, returns_count: returnsCount, leak_loss: leakLoss,
          certain_tx: certainTx, certain_net: certainNet,
          probable_tx: probableTx, probable_net: probableNet,
        },
        stores,
        months,
        store_totals: Object.fromEntries(storeTotals),
        leaks: leaks.reverse().slice(0, 200), // yeni → eski
        girne: girne.reverse().slice(0, 200),
      };
    }),

  /**
   * MÜŞTERİ ANALİZİ — sadık / yüksek harcamalı müşteri takibi.
   * Dönem içi net harcamaya göre sıralı müşteri listesi (iadeler net'e dahil,
   * yani iade eden müşterinin katkısı şişmez) + KPI'lar + sadakat bandı.
   * "Yeni müşteri" = ilk alışverişi bu dönemde olan (tüm-zaman min tarihe göre).
   */
  customers: adminProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => computeCustomers(ctx, input)),

  /**
   * Müşteri detay kartı — TÜM ZAMAN: aylık harcama serisi, en çok alınan
   * ürünler, mağaza/ödeme dağılımı, son alışverişler. Kod varsa kodla eşleşir.
   */
  customerDetail: adminProcedure
    .input(nebimCustomerDetailSchema)
    .query(async ({ ctx, input }) => {
      const where: Prisma.NebimSaleLineWhereInput = input.customer_code
        ? { customer_code: input.customer_code }
        : { customer_name: input.customer_name };
      const lines = await ctx.prisma.nebimSaleLine.findMany({
        where,
        select: {
          invoice_date: true, invoice_ref: true, item_desc: true, qty: true,
          net_amount: true, is_return: true, payment_type: true,
          store: { select: { name: true } },
        },
        orderBy: [{ invoice_date: "asc" }],
        take: 2000,
      });

      const monthly = new Map<string, { net: number; refs: Set<string> }>();
      const products = new Map<string, { units: number; net: number }>();
      const stores = new Map<string, number>();
      const payments = new Map<string, number>();
      const allRefs = new Set<string>();
      let net = 0, units = 0;
      for (const l of lines) {
        const n = Number(l.net_amount ?? 0);
        const q = Number(l.qty ?? 0);
        net += n;
        allRefs.add(l.invoice_ref);
        const mk = l.invoice_date.toISOString().slice(0, 7);
        let m = monthly.get(mk);
        if (!m) { m = { net: 0, refs: new Set() }; monthly.set(mk, m); }
        m.net += n; m.refs.add(l.invoice_ref);
        if (!l.is_return) {
          units += q;
          const pd = l.item_desc ?? "—";
          const p = products.get(pd) ?? { units: 0, net: 0 };
          p.units += q; p.net += n;
          products.set(pd, p);
        }
        const sn = (l.store?.name ?? "?").replace(/^DERIMOD\s*/i, "");
        stores.set(sn, (stores.get(sn) ?? 0) + n);
        if (l.payment_type) {
          payments.set(l.payment_type, (payments.get(l.payment_type) ?? 0) + n);
        }
      }

      return {
        totals: {
          net, units, invoices: allRefs.size,
          first_date: lines[0]?.invoice_date.toISOString().slice(0, 10) ?? "",
          last_date: lines[lines.length - 1]?.invoice_date.toISOString().slice(0, 10) ?? "",
        },
        monthly: Array.from(monthly.entries())
          .sort()
          .map(([month, m]) => ({ month, net: m.net, invoices: m.refs.size })),
        top_products: Array.from(products.entries())
          .map(([desc, p]) => ({ desc, ...p }))
          .sort((a, b) => b.net - a.net)
          .slice(0, 10),
        by_store: Array.from(stores.entries())
          .map(([name, n]) => ({ name, net: n }))
          .sort((a, b) => b.net - a.net),
        by_payment: Array.from(payments.entries())
          .map(([label, n]) => ({ label, net: n }))
          .sort((a, b) => b.net - a.net),
        recent: lines
          .slice(-10)
          .reverse()
          .map((l) => ({
            date: l.invoice_date.toISOString().slice(0, 10),
            ref: l.invoice_ref,
            desc: l.item_desc,
            net: Number(l.net_amount ?? 0),
            is_return: l.is_return,
            store: (l.store?.name ?? "?").replace(/^DERIMOD\s*/i, ""),
          })),
      };
    }),

  /** Müşteri listesi Excel — dönem + filtreyle, sadakat rozetli. */
  exportCustomers: adminProcedure
    .input(nebimAnalizSchema)
    .mutation(async ({ ctx, input }) => {
      const data = await computeCustomers(ctx, input);
      return buildNebimCustomersExcel({
        rows: data.rows,
        kpi: data.kpi,
        date_from: input.date_from,
        date_to: input.date_to,
      });
    }),

  /**
   * MAĞAZA KARNESİ — sunum kalitesinde mağaza başına dönem özeti.
   * Mağaza filtresinden BAĞIMSIZ (karnede her zaman tüm Derimod mağazaları
   * yan yana), tarih filtresine uyar. Dönem TAM AY ise aylık hedef +
   * gerçekleşme % + ay-sonu tahmini (lineer projeksiyon) + tahmini HGO döner.
   */
  storeScorecard: adminProcedure
    .input(nebimAnalizSchema)
    .query(async ({ ctx, input }) => {
      const base = await buildWhere(ctx, {
        date_from: input.date_from,
        date_to: input.date_to,
      });
      const empty = {
        period: {
          is_full_month: false, year: 0, month: 0, label: "",
          days_in_month: 0, elapsed_days: 0, month_done: false,
        },
        cards: [] as Array<{
          store_id: string; store: string; code: string | null;
          net: number; gross_units: number; return_units: number;
          net_units: number; invoices: number; upt: number; avg_basket: number;
          target: number | null; realized_pct: number | null;
          forecast: number | null; forecast_pct: number | null;
        }>,
      };
      if (!base) return empty;

      // Tam ay mı? (Ay modunda hedef takibi açılır.)
      const from = input.date_from ?? "";
      const to = input.date_to ?? "";
      let isFullMonth = false, year = 0, month = 0, daysInMonth = 0;
      if (from.endsWith("-01") && to.startsWith(from.slice(0, 8))) {
        const [y, m] = from.split("-").map(Number);
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        if (to === `${from.slice(0, 7)}-${String(last).padStart(2, "0")}`) {
          isFullMonth = true; year = y; month = m; daysInMonth = last;
        }
      }
      const now = new Date();
      const nowY = now.getUTCFullYear();
      const nowM = now.getUTCMonth() + 1;
      const monthDone =
        isFullMonth && (year < nowY || (year === nowY && month < nowM));
      const isCurrentMonth = isFullMonth && year === nowY && month === nowM;
      const elapsedDays = monthDone
        ? daysInMonth
        : isCurrentMonth
          ? Math.min(now.getUTCDate(), daysInMonth)
          : 0;

      const MONTH_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

      const [lines, stores, targets] = await Promise.all([
        ctx.prisma.nebimSaleLine.findMany({
          where: base,
          select: {
            store_id: true, invoice_ref: true, qty: true, net_amount: true,
            is_return: true, nebim_store_code: true,
          },
        }),
        ctx.prisma.store.findMany({
          where: {
            deleted_at: null,
            brand: { name: { contains: "derimod", mode: "insensitive" } },
          },
          select: { id: true, name: true },
        }),
        isFullMonth
          ? ctx.prisma.nebimStoreTarget.findMany({ where: { year, month } })
          : Promise.resolve([]),
      ]);

      type Agg = {
        net: number; gross: number; ret: number;
        refs: Set<string>; code: string | null;
      };
      const byStore = new Map<string, Agg>();
      for (const l of lines) {
        if (!l.store_id) continue;
        let a = byStore.get(l.store_id);
        if (!a) {
          a = { net: 0, gross: 0, ret: 0, refs: new Set(), code: null };
          byStore.set(l.store_id, a);
        }
        a.net += Number(l.net_amount ?? 0);
        const q = Math.abs(Number(l.qty ?? 0));
        if (l.is_return) a.ret += q;
        else { a.gross += q; a.refs.add(l.invoice_ref); }
        if (!a.code && l.nebim_store_code) a.code = l.nebim_store_code;
      }
      const targetOf = new Map(
        targets.map((t) => [t.store_id, Number(t.target_try)])
      );

      const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i");
      const orderKey = (s: string) => {
        const n = norm(s);
        if (n.includes("lefkosa")) return 0;
        if (n.includes("girne")) return 1;
        if (n.includes("magusa")) return 2;
        return 3;
      };

      const cards = stores
        .sort((a, b) => orderKey(a.name) - orderKey(b.name))
        .map((s) => {
          const a = byStore.get(s.id);
          const net = a?.net ?? 0;
          const invoices = a?.refs.size ?? 0;
          const gross = a?.gross ?? 0;
          const ret = a?.ret ?? 0;
          const target = targetOf.get(s.id) ?? null;
          // Ay-sonu tahmini: biten ayda gerçekleşen; süren ayda lineer projeksiyon.
          const forecast = monthDone
            ? net
            : isCurrentMonth && elapsedDays > 0
              ? (net / elapsedDays) * daysInMonth
              : null;
          return {
            store_id: s.id,
            store: s.name.replace(/^DERIMOD\s*/i, ""),
            code: a?.code ?? null,
            net,
            gross_units: gross,
            return_units: ret,
            net_units: gross - ret,
            invoices,
            upt: invoices ? gross / invoices : 0,
            avg_basket: invoices ? net / invoices : 0,
            target,
            realized_pct: target && target > 0 ? (net / target) * 100 : null,
            forecast,
            forecast_pct:
              target && target > 0 && forecast != null
                ? (forecast / target) * 100
                : null,
          };
        });

      return {
        period: {
          is_full_month: isFullMonth,
          year, month,
          label: isFullMonth ? `${MONTH_TR[month - 1]} ${year}` : "",
          days_in_month: daysInMonth,
          elapsed_days: elapsedDays,
          month_done: monthDone,
        },
        cards,
      };
    }),

  /** Mağaza Karnesi aylık hedefi kaydet (0 = hedefi kaldır). */
  setStoreTarget: adminProcedure
    .input(nebimStoreTargetSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.target_try <= 0) {
        await ctx.prisma.nebimStoreTarget.deleteMany({
          where: { store_id: input.store_id, year: input.year, month: input.month },
        });
        return { ok: true };
      }
      await ctx.prisma.nebimStoreTarget.upsert({
        where: {
          store_id_year_month: {
            store_id: input.store_id, year: input.year, month: input.month,
          },
        },
        update: { target_try: input.target_try },
        create: {
          store_id: input.store_id, year: input.year, month: input.month,
          target_try: input.target_try,
        },
      });
      return { ok: true };
    }),

  /** Bir müşterinin aldığı ürünler (drill-down) — filtre + customer_name. */
  customerProducts: adminProcedure
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
