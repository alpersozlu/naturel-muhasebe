import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * NEBİM canlı server karşılaştırması (Derimod 3. kontrol aşaması).
 *
 * Bir günün (gün birleşmesi varsa tüm grup günlerinin) Nebim'e kayıtlı net
 * satış toplamını (iadeler düşülü) hesaplar ve Mağaza Özeti satış toplamıyla
 * kıyaslar. Mağaza kodları (9400-9403 / S01-S03) store_id ile eşli olduğundan
 * doğrudan store_id + invoice_date ile filtrelenir.
 *
 * Nebim verisi yoksa (örn. Mavi mağazaları) null döner → UI bloğu gösterilmez.
 */

export type NebimDaySummary = {
  net: number; // sales - returns
  sales: number;
  returns: number;
  line_count: number;
  invoice_count: number;
  summary_sales: number; // Mağaza Özeti satış toplamı (karşılaştırma tabanı)
  difference: number; // net - summary_sales
};

export async function computeNebimDaySummary(
  prisma: PrismaClient,
  dailyRecordId: string
): Promise<NebimDaySummary | null> {
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: dailyRecordId },
    select: {
      store_id: true,
      date: true,
      store_summary: { select: { sales_total_try: true } },
      merge_group: {
        select: {
          daily_records: {
            select: {
              date: true,
              store_summary: { select: { sales_total_try: true } },
            },
          },
        },
      },
    },
  });
  if (!dr) return null;

  // Gün birleşmesi: tüm grup günleri; yoksa sadece bu gün.
  const dates = dr.merge_group
    ? dr.merge_group.daily_records.map((r) => r.date)
    : [dr.date];
  const summarySales = dr.merge_group
    ? dr.merge_group.daily_records.find((r) => r.store_summary)?.store_summary
        ?.sales_total_try?.toNumber() ?? 0
    : dr.store_summary?.sales_total_try?.toNumber() ?? 0;

  const lines = await prisma.nebimSaleLine.findMany({
    where: { store_id: dr.store_id, invoice_date: { in: dates } },
    select: { net_amount: true, is_return: true, invoice_ref: true },
  });
  if (lines.length === 0) return null;

  // ÖNEMLİ: Nebim iadeleri (is_return) net_amount'ı ZATEN NEGATİF saklar.
  // Bu yüzden net satış = tüm net_amount toplamı (iadeler kendiliğinden düşülür).
  // Derimod Satışları sayfasıyla (_sum net_amount) birebir aynı sonucu verir.
  let total = 0; // = net satış (iadeler dahil/negatif)
  let returns = 0; // sadece iade satırları toplamı (negatif) — gösterim için
  const invoices = new Set<string>();
  for (const l of lines) {
    const amt = l.net_amount?.toNumber() ?? 0;
    total += amt;
    if (l.is_return) returns += amt;
    invoices.add(l.invoice_ref);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const net = r2(total);
  return {
    net,
    sales: r2(total - returns), // iade öncesi brüt (iade satırları hariç)
    returns: r2(returns), // negatif (iade tutarı)
    line_count: lines.length,
    invoice_count: invoices.size,
    summary_sales: r2(summarySales),
    difference: r2(net - summarySales),
  };
}
