import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";
import { TOLERANCE_TL } from "@/lib/constants";

/**
 * Kasa Farkı Analitiği
 *
 * Mağazaların gün-gün uzlaşma farklarını toplar:
 *   - documents = POS toplam + Nakit (müdür sayımı varsa) + Kartuş puan
 *     (elimize geçen)
 *   - summary = StoreSummary.sales_total (olması gereken)
 *   - difference = documents − summary
 *
 * Negatif = elimize geçen olması gerekenden az → EKSİK (kayıp/hırsızlık sinyali).
 * Pozitif = elimize geçen olması gerekenden fazla → fazla nakit / üst kalmış.
 */

export type DayVariance = {
  date: string; // ISO YYYY-MM-DD
  difference: number;
  notes: string | null;
  locked: boolean;
  /** |difference| <= TOLERANCE_TL */
  within_tolerance: boolean;
};

export type StoreCashVariance = {
  store_id: string;
  store_name: string;
  brand_name: string;
  /** Net Δ (aylık toplam fark — pozitif veya negatif) */
  net_diff: number;
  /** Σ negatif farklar (eksiklikler) — mutlak değer */
  total_deficit: number;
  /** Σ pozitif farklar (fazlalıklar) */
  total_surplus: number;
  /** Tolerans dışı (|Δ| > 5 TL) günler sayısı */
  days_with_variance: number;
  /** Mağaza özeti yüklenmiş tüm günler (tolerans içinde olanlar da dahil) */
  days: DayVariance[];
};

export type CashVarianceSummary = {
  period_label: string;
  total_deficit: number;
  total_surplus: number;
  net: number;
  stores_with_deficit: number;
  stores_count: number;
  by_store: StoreCashVariance[];
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export async function cashVarianceSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<CashVarianceSummary> {
  const currentStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const currentEnd = new Date(Date.UTC(filter.year, filter.month, 1));

  // Store scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  // Tüm DailyRecord'ları çek — verification veya store_summary olanlar
  const records = await prisma.dailyRecord.findMany({
    where: {
      date: { gte: currentStart, lt: currentEnd },
      ...(storeIds ? { store_id: { in: storeIds } } : {}),
      // En az summary olmalı, yoksa varyans hesaplanamaz
      store_summary: { isNot: null },
    },
    include: {
      store: { include: { brand: true } },
      store_summary: {
        select: {
          cash_sales_try: true,
          loyalty_points_total_try: true,
          sales_total_try: true,
        },
      },
      pos_slips: {
        select: {
          net_amount_try: true,
          upload: { select: { status: true } },
        },
      },
    },
  });

  // Aktif mağaza sayısı için kapsamdaki tüm mağazalar (varyans olmasa da sayılsın)
  const allStoresInScope = storeIds
    ? await prisma.store.findMany({
        where: { id: { in: storeIds }, deleted_at: null },
        select: { id: true, name: true, brand: { select: { name: true } } },
      })
    : await prisma.store.findMany({
        where: { deleted_at: null },
        select: { id: true, name: true, brand: { select: { name: true } } },
      });

  // Per-store bucket
  const byStoreMap: Record<string, StoreCashVariance> = {};
  for (const s of allStoresInScope) {
    byStoreMap[s.id] = {
      store_id: s.id,
      store_name: s.name,
      brand_name: s.brand.name,
      net_diff: 0,
      total_deficit: 0,
      total_surplus: 0,
      days_with_variance: 0,
      days: [],
    };
  }

  // Her gün için varyansı hesapla
  for (const dr of records) {
    if (!dr.store_summary) continue;

    const includedPos = dr.pos_slips.filter(
      (p) => p.upload.status === "parsed" || p.upload.status === "confirmed"
    );
    const posSum = includedPos.reduce((s, p) => s + num(p.net_amount_try), 0);

    const summaryCash = num(dr.store_summary.cash_sales_try);
    const loyalty = num(dr.store_summary.loyalty_points_total_try);
    const summarySales = num(dr.store_summary.sales_total_try);
    const reportedCash = dr.reported_cash_try ? num(dr.reported_cash_try) : null;
    const effectiveCash = reportedCash ?? summaryCash;

    const documents = posSum + effectiveCash + loyalty;
    const summary = summarySales;
    // Sign konvansiyonu: docs − summary (elime geçen − olması gereken)
    const diff = documents - summary;

    // Tolerans içindeyse yine de net_diff'e ekle ama days listesine alma
    const bucket = byStoreMap[dr.store_id];
    if (!bucket) continue;

    bucket.net_diff += diff;
    const withinTolerance = Math.abs(diff) <= TOLERANCE_TL;
    // Tüm summary'li günler days[]'a eklenir — UI tarafında tolerans içinde
    // olanlar pasif (gri), olmayanlar vurgulu gösterilir.
    bucket.days.push({
      date: dr.date.toISOString().slice(0, 10),
      difference: diff,
      notes: dr.reconciliation_notes,
      locked: dr.status === "locked",
      within_tolerance: withinTolerance,
    });
    if (!withinTolerance) {
      bucket.days_with_variance += 1;
      if (diff < 0) {
        bucket.total_deficit += Math.abs(diff);
      } else {
        bucket.total_surplus += diff;
      }
    }
  }

  // Mağaza listesi — eksiği en yüksek olanlar üstte (sorun çözücü öncelik)
  const by_store = Object.values(byStoreMap)
    .sort((a, b) => {
      // Eksiği olan üstte, sonra fazlası olan, sonra temiz
      if (a.total_deficit > 0 || b.total_deficit > 0) {
        return b.total_deficit - a.total_deficit;
      }
      return b.total_surplus - a.total_surplus;
    })
    .map((s) => ({
      ...s,
      days: s.days.sort((a, b) => b.date.localeCompare(a.date)), // en yeni gün üstte
    }));

  // Aggregate totals
  const total_deficit = by_store.reduce((s, x) => s + x.total_deficit, 0);
  const total_surplus = by_store.reduce((s, x) => s + x.total_surplus, 0);
  const stores_with_deficit = by_store.filter((s) => s.total_deficit > 0).length;

  return {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    total_deficit,
    total_surplus,
    net: total_surplus - total_deficit,
    stores_with_deficit,
    stores_count: by_store.length,
    by_store,
  };
}
