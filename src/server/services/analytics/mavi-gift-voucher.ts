import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

/**
 * MAVİ HEDİYE ÇEKİ istatistiği — Derimod mağazalarında girilen, Mavi'den gelen
 * hediye çekleri. Kasa ile alakası yok, sadece bilgi/istatistik.
 *
 * Çıktı:
 *  - total: seçili ayın toplamı (tüm Derimod mağazaları)
 *  - ytd_total: yılbaşından seçili ay sonuna kadar
 *  - by_store: her Derimod mağazası ayrı (ay toplamı + yıl toplamı)
 *  - monthly_trend: seçili yıl için 12 ay (toplam)
 */
export type MaviGiftVoucherSummary = {
  period_label: string;
  total: number;
  ytd_total: number;
  by_store: Array<{
    store_id: string;
    store_name: string;
    month_total: number;
    year_total: number;
  }>;
  monthly_trend: Array<{ month: number; label: string; total: number }>;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

export async function maviGiftVoucherSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<MaviGiftVoucherSummary> {
  // Sadece Derimod markalı, silinmemiş mağazalar
  const derimodStores = await prisma.store.findMany({
    where: {
      deleted_at: null,
      ...(filter.store_id ? { id: filter.store_id } : {}),
      brand: {
        name: { contains: "derimod", mode: "insensitive" },
        ...(filter.brand_id ? { id: filter.brand_id } : {}),
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const storeIds = derimodStores.map((s) => s.id);

  const emptyResult: MaviGiftVoucherSummary = {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    total: 0,
    ytd_total: 0,
    by_store: derimodStores.map((s) => ({
      store_id: s.id,
      store_name: s.name,
      month_total: 0,
      year_total: 0,
    })),
    monthly_trend: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      label: `${MONTH_LABELS[i]} ${filter.year}`,
      total: 0,
    })),
  };
  if (storeIds.length === 0) return emptyResult;

  // Yıl boyu kayıtlar (mavi_gift_voucher_try dolu olanlar)
  const yearStart = new Date(Date.UTC(filter.year, 0, 1));
  const yearEnd = new Date(Date.UTC(filter.year + 1, 0, 1));
  const records = await prisma.dailyRecord.findMany({
    where: {
      store_id: { in: storeIds },
      date: { gte: yearStart, lt: yearEnd },
      mavi_gift_voucher_try: { not: null },
    },
    select: {
      store_id: true,
      date: true,
      mavi_gift_voucher_try: true,
    },
  });

  // Aggregate
  const byStoreMonth: Record<string, number> = {}; // store_id → ay toplamı
  const byStoreYear: Record<string, number> = {}; // store_id → yıl toplamı
  const monthlyTotals: number[] = Array.from({ length: 12 }, () => 0);
  let total = 0;
  let ytd_total = 0;

  for (const r of records) {
    const v = num(r.mavi_gift_voucher_try);
    const m = r.date.getUTCMonth(); // 0-11
    monthlyTotals[m]! += v;
    byStoreYear[r.store_id] = (byStoreYear[r.store_id] ?? 0) + v;
    if (m === filter.month - 1) {
      total += v;
      byStoreMonth[r.store_id] = (byStoreMonth[r.store_id] ?? 0) + v;
    }
    if (m < filter.month) {
      ytd_total += v;
    }
  }

  return {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    total,
    ytd_total,
    by_store: derimodStores
      .map((s) => ({
        store_id: s.id,
        store_name: s.name,
        month_total: byStoreMonth[s.id] ?? 0,
        year_total: byStoreYear[s.id] ?? 0,
      }))
      .sort((a, b) => b.year_total - a.year_total),
    monthly_trend: monthlyTotals.map((t, i) => ({
      month: i + 1,
      label: `${MONTH_LABELS[i]} ${filter.year}`,
      total: t,
    })),
  };
}
