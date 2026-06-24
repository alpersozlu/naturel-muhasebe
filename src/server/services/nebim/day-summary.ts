import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * NEBİM canlı server karşılaştırması (Derimod 3. kontrol aşaması).
 *
 * Bir günün (gün birleşmesi varsa tüm grup günlerinin) Nebim'e kayıtlı net
 * satış toplamını (iadeler düşülü) hesaplar ve Mağaza Özeti satış toplamıyla
 * kıyaslar. Ayrıca Nebim'in ödeme kırılımını (nakit / kredi kartı) Mağaza
 * Özeti'nin nakit / kredi kartı kalemleriyle kıyaslar (veri varsa).
 *
 * Mağaza kodları store_id ile eşli olduğundan store_id + invoice_date filtrelenir.
 * Nebim verisi yoksa (örn. Mavi mağazaları) null döner → UI bloğu gösterilmez.
 */

export type NebimPaymentCompare = {
  nebim_cash: number;
  nebim_card: number;
  summary_cash: number;
  summary_card: number;
  cash_diff: number; // nebim_cash - summary_cash
  card_diff: number; // nebim_card - summary_card
};

export type NebimDaySummary = {
  net: number; // sales - returns
  sales: number;
  returns: number;
  line_count: number;
  invoice_count: number;
  summary_sales: number; // Mağaza Özeti satış toplamı (karşılaştırma tabanı)
  difference: number; // net - summary_sales
  payment: NebimPaymentCompare | null; // ödeme kırılımı kıyası (veri varsa)
};

export async function computeNebimDaySummary(
  prisma: PrismaClient,
  dailyRecordId: string
): Promise<NebimDaySummary | null> {
  const summarySelect = {
    sales_total_try: true,
    cash_sales_try: true,
    cash_sales: true,
    credit_card_total_try: true,
    credit_card_total: true,
  } as const;

  const dr = await prisma.dailyRecord.findUnique({
    where: { id: dailyRecordId },
    select: {
      store_id: true,
      date: true,
      store_summary: { select: summarySelect },
      merge_group: {
        select: {
          daily_records: {
            select: {
              date: true,
              store_summary: { select: summarySelect },
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
  const summary = dr.merge_group
    ? dr.merge_group.daily_records.find((r) => r.store_summary)?.store_summary ?? null
    : dr.store_summary;

  const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
  const summarySales = num(summary?.sales_total_try);

  const lines = await prisma.nebimSaleLine.findMany({
    where: { store_id: dr.store_id, invoice_date: { in: dates } },
    select: {
      net_amount: true,
      is_return: true,
      invoice_ref: true,
      pay_cash: true,
      pay_card: true,
    },
  });
  if (lines.length === 0) return null;

  // ÖNEMLİ: Nebim iadeleri (is_return) net_amount'ı ZATEN NEGATİF saklar.
  // net satış = tüm net_amount toplamı (iadeler kendiliğinden düşülür).
  let total = 0; // = net satış (iadeler dahil/negatif)
  let returns = 0; // sadece iade satırları toplamı (negatif) — gösterim için
  const invoices = new Set<string>();

  // Ödeme kırılımı: pay_cash/pay_card tutarları fatura-bazlı (her satırda tekrar)
  // → fatura başına BİR kez say. Brüt satış (iade hariç) nakit/kart.
  const payInvoices = new Set<string>();
  let nebimCash = 0;
  let nebimCard = 0;
  let hasPaymentData = false;

  for (const l of lines) {
    const amt = num(l.net_amount);
    total += amt;
    if (l.is_return) returns += amt;
    invoices.add(l.invoice_ref);

    if (l.pay_cash != null || l.pay_card != null) hasPaymentData = true;
    if (!l.is_return && !payInvoices.has(l.invoice_ref)) {
      payInvoices.add(l.invoice_ref);
      nebimCash += num(l.pay_cash);
      nebimCard += num(l.pay_card);
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const net = r2(total);

  let payment: NebimPaymentCompare | null = null;
  if (hasPaymentData) {
    const summaryCash = num(summary?.cash_sales_try) || num(summary?.cash_sales);
    const summaryCard =
      num(summary?.credit_card_total_try) || num(summary?.credit_card_total);
    payment = {
      nebim_cash: r2(nebimCash),
      nebim_card: r2(nebimCard),
      summary_cash: r2(summaryCash),
      summary_card: r2(summaryCard),
      cash_diff: r2(nebimCash - summaryCash),
      card_diff: r2(nebimCard - summaryCard),
    };
  }

  return {
    net,
    sales: r2(total - returns), // iade öncesi brüt (iade satırları hariç)
    returns: r2(returns), // negatif (iade tutarı)
    line_count: lines.length,
    invoice_count: invoices.size,
    summary_sales: r2(summarySales),
    difference: r2(net - summarySales),
    payment,
  };
}
