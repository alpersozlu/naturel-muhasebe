import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

/**
 * ALIŞVERİŞ ÇEKİ TAKİBİ — Mağaza Özeti'nden (kasa raporu) otomatik yakalanan
 * "Alışveriş Çeki Toplam" kalemlerinin ay bazında, tarihli dökümü.
 *
 * Amaç: Mavi HQ (Türkiye) kullanılan alışveriş çeklerini işletmeye iade eder;
 * kullanıcı bu tarihli listeyi Türkiye'ye bildirip iadeyi talep eder.
 * Kaynak: StoreSummary.shopping_voucher_total (OCR ile Mağaza Özeti'nden okunur).
 */
export type ShoppingVoucherEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  store_name: string;
  brand_name: string;
};

export type ShoppingVouchersSummary = {
  period_label: string;
  year: number;
  month: number;
  entries: ShoppingVoucherEntry[];
  grand_total: number;
  entry_count: number;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export async function shoppingVouchersSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<ShoppingVouchersSummary> {
  const monthStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const monthEnd = new Date(Date.UTC(filter.year, filter.month, 1));

  // Mağaza scope (marka verildiyse o markanın mağazaları)
  let storeIds: string[] | undefined = filter.store_id
    ? [filter.store_id]
    : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const summaries = await prisma.storeSummary.findMany({
    where: {
      shopping_voucher_total: { gt: 0 },
      daily_record: {
        date: { gte: monthStart, lt: monthEnd },
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
      },
    },
    select: {
      id: true,
      shopping_voucher_total: true,
      shopping_voucher_total_try: true,
      daily_record: {
        select: {
          date: true,
          store: {
            select: { name: true, brand: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { daily_record: { date: "asc" } },
  });

  let grandTotal = 0;
  const entries: ShoppingVoucherEntry[] = summaries.map((s) => {
    const amount = num(s.shopping_voucher_total_try ?? s.shopping_voucher_total);
    grandTotal += amount;
    return {
      id: s.id,
      date: s.daily_record.date.toISOString().slice(0, 10),
      amount,
      store_name: s.daily_record.store.name,
      brand_name: s.daily_record.store.brand.name,
    };
  });

  return {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    year: filter.year,
    month: filter.month,
    entries,
    grand_total: grandTotal,
    entry_count: entries.length,
  };
}
