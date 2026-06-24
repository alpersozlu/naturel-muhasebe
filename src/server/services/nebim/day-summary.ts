import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * NEBİM canlı server karşılaştırması (Derimod 3. kontrol aşaması).
 *
 * Bir günün (gün birleşmesi varsa tüm grup günlerinin):
 *  1. Nebim net satış toplamı ↔ Mağaza Özeti satış toplamı.
 *  2. Nebim nakit / kredi kartı ↔ Mağaza Özeti nakit / kredi kartı.
 *  3. Nebim kart tutarı BANKA bazında ↔ yüklenen POS slipleri (çalışan Nebim'e
 *     doğru kart tipini girmiş mi? "Maksimum" dedi ama gerçekten İş Bankası
 *     slibi var mı, tutar tutuyor mu?).
 *
 * Nebim verisi yoksa null döner → UI bloğu gösterilmez.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;

/** Nebim kart tipi (kart markası) → kanonik banka adı. */
function bankFromNebimCard(cardType: string): string {
  if (cardType.includes(",")) return "Karma kart";
  const t = cardType.toLocaleLowerCase("tr");
  if (t.includes("maksimum") || t.includes("maximum")) return "İş Bankası";
  if (t.includes("optimum")) return "Koopbank";
  if (t.includes("garanti")) return "Garanti";
  if (t.includes("teb")) return "TEB";
  if (t.includes("ziraat")) return "Ziraat";
  if (t.includes("cardplus")) return "Cardplus";
  return cardType;
}

/** POS slip banka adı (OCR, varyantlı) → kanonik banka adı. */
function bankFromSlip(name: string): string {
  const t = name.toLocaleLowerCase("tr");
  if (t.includes("iş bank") || t.includes("is bank") || t.includes("isbank")) return "İş Bankası";
  if (t.includes("koop")) return "Koopbank";
  if (t.includes("garanti")) return "Garanti";
  if (t.includes("teb")) return "TEB";
  if (t.includes("ziraat")) return "Ziraat";
  if (t.includes("nova")) return "Nova Bank";
  if (t.includes("cardplus") || t.includes("creditwest")) return "Cardplus";
  return name;
}

export type NebimPaymentCompare = {
  nebim_cash: number;
  nebim_card: number;
  summary_cash: number;
  summary_card: number;
  cash_diff: number;
  card_diff: number;
};

export type NebimBankCompare = {
  bank: string;
  nebim: number; // Nebim'deki bu bankaya işaretli kart tutarı
  slip: number; // yüklenen POS slip toplamı
  slip_count: number;
  diff: number; // nebim - slip
};

export type NebimDaySummary = {
  net: number;
  sales: number;
  returns: number;
  line_count: number;
  invoice_count: number;
  summary_sales: number;
  difference: number;
  payment: NebimPaymentCompare | null;
  card_by_bank: NebimBankCompare[] | null; // banka bazında kart ↔ POS slip
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
              id: true,
              date: true,
              store_summary: { select: summarySelect },
            },
          },
        },
      },
    },
  });
  if (!dr) return null;

  const dates = dr.merge_group
    ? dr.merge_group.daily_records.map((r) => r.date)
    : [dr.date];
  const recordIds = dr.merge_group
    ? dr.merge_group.daily_records.map((r) => r.id)
    : [dailyRecordId];
  const summary = dr.merge_group
    ? dr.merge_group.daily_records.find((r) => r.store_summary)?.store_summary ?? null
    : dr.store_summary;

  const summarySales = num(summary?.sales_total_try);

  const [lines, slips] = await Promise.all([
    prisma.nebimSaleLine.findMany({
      where: { store_id: dr.store_id, invoice_date: { in: dates } },
      select: {
        net_amount: true,
        is_return: true,
        invoice_ref: true,
        pay_cash: true,
        pay_card: true,
        card_type: true,
      },
    }),
    prisma.posSlip.findMany({
      where: { daily_record_id: { in: recordIds } },
      select: { bank_name: true, net_amount_try: true, net_amount: true },
    }),
  ]);
  if (lines.length === 0) return null;

  // 1) Net satış + 2) nakit/kart (fatura-bazlı tutarlar → fatura başına bir kez)
  let total = 0;
  let returns = 0;
  const invoices = new Set<string>();
  const payInvoices = new Set<string>();
  let nebimCash = 0;
  let nebimCard = 0;
  let hasPaymentData = false;

  // 3) banka bazında kart (Nebim tarafı)
  const bankMap = new Map<string, { nebim: number; slip: number; slip_count: number }>();
  const bank = (k: string) => {
    let o = bankMap.get(k);
    if (!o) {
      o = { nebim: 0, slip: 0, slip_count: 0 };
      bankMap.set(k, o);
    }
    return o;
  };

  for (const l of lines) {
    const amt = num(l.net_amount);
    total += amt;
    if (l.is_return) returns += amt;
    invoices.add(l.invoice_ref);

    if (l.pay_cash != null || l.pay_card != null) hasPaymentData = true;
    if (!l.is_return && !payInvoices.has(l.invoice_ref)) {
      payInvoices.add(l.invoice_ref);
      const cash = num(l.pay_cash);
      const card = num(l.pay_card);
      nebimCash += cash;
      nebimCard += card;
      if (card > 0 && l.card_type) bank(bankFromNebimCard(l.card_type)).nebim += card;
    }
  }

  // POS slip tarafı
  for (const s of slips) {
    const amt = num(s.net_amount_try) || num(s.net_amount);
    const o = bank(bankFromSlip(s.bank_name ?? "(banka yok)"));
    o.slip += amt;
    o.slip_count += 1;
  }

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

  const card_by_bank: NebimBankCompare[] = Array.from(bankMap.entries())
    .map(([b, v]) => ({
      bank: b,
      nebim: r2(v.nebim),
      slip: r2(v.slip),
      slip_count: v.slip_count,
      diff: r2(v.nebim - v.slip),
    }))
    .sort((a, b) => b.nebim + b.slip - (a.nebim + a.slip));

  return {
    net,
    sales: r2(total - returns),
    returns: r2(returns),
    line_count: lines.length,
    invoice_count: invoices.size,
    summary_sales: r2(summarySales),
    difference: r2(net - summarySales),
    payment,
    card_by_bank: card_by_bank.length > 0 ? card_by_bank : null,
  };
}
