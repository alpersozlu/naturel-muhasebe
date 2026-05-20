import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

export type RevenueSummary = {
  // ---- Core (current month) ----
  total: number;
  cash: number;
  pos: number;
  loyalty: number;
  daily_avg: number;
  active_days: number;
  daily_series: Array<{ day: number; cash: number; pos: number; total: number }>;
  by_store: Array<{ store_id: string; store_name: string; total: number; cash: number; pos: number }>;
  by_bank: Array<{ bank_name: string; total: number }>;

  // ---- Trends ----
  /** Aynı filtre kapsamı, geçen ayın toplam cirosu */
  prev_month_total: number;
  /** Aynı filtre kapsamı, geçen yıl aynı ay toplam cirosu */
  prev_year_total: number;
  /** Son 12 ay (kronolojik, en eski → en yeni). Eksik aylar 0 ile doldurulur. */
  sparkline: Array<{ month_key: string; label: string; total: number }>;
  /** Son 3 ay (kronolojik). Nakit oranı sağlık göstergesi için. */
  cash_ratio_trend: Array<{ month_key: string; label: string; cash: number; total: number; ratio: number }>;

  // ---- Splits ----
  by_brand: Array<{
    brand_id: string;
    brand_name: string;
    total: number;
    cash: number;
    pos: number;
    prev_month_total: number;
    sparkline: Array<{ month_key: string; total: number }>;
    stores: Array<{ store_id: string; store_name: string; total: number; cash: number; pos: number }>;
  }>;
  /** Pzt (0) → Pzr (6) sıralı, sadece cari ay */
  weekday_pattern: Array<{ dow: number; label: string; total: number; days: number; avg: number }>;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function revenueSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<RevenueSummary> {
  const currentStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const currentEnd = new Date(Date.UTC(filter.year, filter.month, 1));
  // 13-month rolling window: prev-year same-month → current end (exclusive)
  const extStart = new Date(Date.UTC(filter.year - 1, filter.month - 1, 1));

  // Resolve store scope (brand → all stores under brand)
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const storeScope = storeIds ? { store_id: { in: storeIds } } : {};

  // 13-month summary fetch — single query covers current + trends + brand split
  const extSummaries = await prisma.storeSummary.findMany({
    where: {
      daily_record: { date: { gte: extStart, lt: currentEnd }, ...storeScope },
    },
    include: {
      daily_record: { include: { store: { include: { brand: true } } } },
    },
  });

  // Current-month POS slips for bank breakdown (only current month needed)
  const posSlips = await prisma.posSlip.findMany({
    where: {
      daily_record: { date: { gte: currentStart, lt: currentEnd }, ...storeScope },
      upload: { status: { in: ["parsed", "confirmed"] } },
    },
  });

  // ---- Aggregate buckets ----
  type MonthBucket = { total: number; cash: number; pos: number };
  const monthlyAll: Record<string, MonthBucket> = {};
  const monthlyByBrand: Record<string, Record<string, MonthBucket>> = {};
  const brandNames: Record<string, string> = {};
  // Cari ay: marka → mağaza → toplam
  const currentStoresByBrand: Record<
    string,
    Record<string, { store_name: string; total: number; cash: number; pos: number }>
  > = {};

  let total = 0;
  let cash = 0;
  let pos = 0;
  let loyalty = 0;
  const activeDays = new Set<string>();
  const daily: Record<number, { cash: number; pos: number; total: number }> = {};
  const byStoreMap: Record<string, { name: string; total: number; cash: number; pos: number }> = {};
  const weekdayTotals: Array<{ total: number; daySet: Set<string> }> = Array.from(
    { length: 7 },
    () => ({ total: 0, daySet: new Set<string>() })
  );

  for (const s of extSummaries) {
    const date = s.daily_record.date;
    const mk = monthKey(date);
    const sTotal = num(s.sales_total_try);
    const sCash = num(s.cash_sales_try);
    const sCC = num(s.credit_card_total_try);
    const sLoyalty = num(s.loyalty_points_total_try);
    const brandId = s.daily_record.store.brand_id;
    const brandName = s.daily_record.store.brand.name;
    brandNames[brandId] = brandName;

    // All-stores monthly bucket
    monthlyAll[mk] ??= { total: 0, cash: 0, pos: 0 };
    monthlyAll[mk].total += sTotal;
    monthlyAll[mk].cash += sCash;
    monthlyAll[mk].pos += sCC;

    // Per-brand monthly bucket
    monthlyByBrand[brandId] ??= {};
    monthlyByBrand[brandId]![mk] ??= { total: 0, cash: 0, pos: 0 };
    monthlyByBrand[brandId]![mk]!.total += sTotal;
    monthlyByBrand[brandId]![mk]!.cash += sCash;
    monthlyByBrand[brandId]![mk]!.pos += sCC;

    // Current-month-only aggregations
    if (date >= currentStart && date < currentEnd) {
      const dayN = date.getUTCDate();
      total += sTotal;
      cash += sCash;
      pos += sCC;
      loyalty += sLoyalty;
      activeDays.add(date.toISOString());

      daily[dayN] ??= { cash: 0, pos: 0, total: 0 };
      daily[dayN].cash += sCash;
      daily[dayN].pos += sCC;
      daily[dayN].total += sTotal;

      const sid = s.daily_record.store_id;
      byStoreMap[sid] ??= { name: s.daily_record.store.name, total: 0, cash: 0, pos: 0 };
      byStoreMap[sid].total += sTotal;
      byStoreMap[sid].cash += sCash;
      byStoreMap[sid].pos += sCC;

      // Per-brand store map (current month only)
      currentStoresByBrand[brandId] ??= {};
      currentStoresByBrand[brandId]![sid] ??= {
        store_name: s.daily_record.store.name,
        total: 0,
        cash: 0,
        pos: 0,
      };
      currentStoresByBrand[brandId]![sid]!.total += sTotal;
      currentStoresByBrand[brandId]![sid]!.cash += sCash;
      currentStoresByBrand[brandId]![sid]!.pos += sCC;

      const dow = (date.getUTCDay() + 6) % 7; // 0=Mon
      weekdayTotals[dow]!.total += sTotal;
      weekdayTotals[dow]!.daySet.add(date.toISOString());
    }
  }

  // ---- Bank breakdown (current month) ----
  const byBankMap: Record<string, number> = {};
  for (const p of posSlips) {
    const bank = p.bank_name ?? "Bilinmeyen";
    byBankMap[bank] = (byBankMap[bank] ?? 0) + num(p.net_amount_try);
  }

  // ---- Daily series (current month, zero-filled) ----
  const daysInMonth = new Date(Date.UTC(filter.year, filter.month, 0)).getUTCDate();
  const daily_series = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const v = daily[d] ?? { cash: 0, pos: 0, total: 0 };
    return { day: d, ...v };
  });

  // ---- By store / By bank (sorted) ----
  const by_store = Object.entries(byStoreMap)
    .map(([id, v]) => ({
      store_id: id,
      store_name: v.name,
      total: v.total,
      cash: v.cash,
      pos: v.pos,
    }))
    .sort((a, b) => b.total - a.total);

  const by_bank = Object.entries(byBankMap)
    .map(([bank_name, t]) => ({ bank_name, total: t }))
    .sort((a, b) => b.total - a.total);

  // ---- Sparkline: last 12 months, oldest → newest ----
  const sparkline: Array<{ month_key: string; label: string; total: number }> = [];
  for (let offset = 11; offset >= 0; offset--) {
    const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = ymKey(y, m);
    sparkline.push({
      month_key: key,
      label: MONTH_LABELS_SHORT[m - 1]!,
      total: monthlyAll[key]?.total ?? 0,
    });
  }

  // ---- Cash ratio trend: last 3 months ----
  const cash_ratio_trend: RevenueSummary["cash_ratio_trend"] = [];
  for (let offset = 2; offset >= 0; offset--) {
    const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = ymKey(y, m);
    const bucket = monthlyAll[key] ?? { total: 0, cash: 0, pos: 0 };
    cash_ratio_trend.push({
      month_key: key,
      label: MONTH_LABELS_SHORT[m - 1]!,
      cash: bucket.cash,
      total: bucket.total,
      ratio: bucket.total > 0 ? bucket.cash / bucket.total : 0,
    });
  }

  // ---- Prev month / prev year (same filter scope) ----
  const prevMonthDate = new Date(Date.UTC(filter.year, filter.month - 2, 1));
  const prevMonthKey = ymKey(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1);
  const prev_month_total = monthlyAll[prevMonthKey]?.total ?? 0;
  const prevYearKey = ymKey(filter.year - 1, filter.month);
  const prev_year_total = monthlyAll[prevYearKey]?.total ?? 0;

  // ---- By brand (current month + prev + 12-month spark) ----
  const currentKey = ymKey(filter.year, filter.month);
  const by_brand = Object.entries(monthlyByBrand)
    .map(([brandId, months]) => {
      const cur = months[currentKey] ?? { total: 0, cash: 0, pos: 0 };
      const prev = months[prevMonthKey]?.total ?? 0;
      const brandSpark: Array<{ month_key: string; total: number }> = [];
      for (let offset = 11; offset >= 0; offset--) {
        const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
        const key = ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
        brandSpark.push({ month_key: key, total: months[key]?.total ?? 0 });
      }
      const storesMap = currentStoresByBrand[brandId] ?? {};
      const stores = Object.entries(storesMap)
        .map(([store_id, v]) => ({
          store_id,
          store_name: v.store_name,
          total: v.total,
          cash: v.cash,
          pos: v.pos,
        }))
        .sort((a, b) => b.total - a.total);
      return {
        brand_id: brandId,
        brand_name: brandNames[brandId] ?? "—",
        total: cur.total,
        cash: cur.cash,
        pos: cur.pos,
        prev_month_total: prev,
        sparkline: brandSpark,
        stores,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- Weekday pattern ----
  const weekday_pattern = weekdayTotals.map((w, i) => ({
    dow: i,
    label: WEEKDAY_LABELS[i]!,
    total: w.total,
    days: w.daySet.size,
    avg: w.daySet.size > 0 ? w.total / w.daySet.size : 0,
  }));

  return {
    total,
    cash,
    pos,
    loyalty,
    daily_avg: activeDays.size > 0 ? total / activeDays.size : 0,
    active_days: activeDays.size,
    daily_series,
    by_store,
    by_bank,
    prev_month_total,
    prev_year_total,
    sparkline,
    cash_ratio_trend,
    by_brand,
    weekday_pattern,
  };
}
