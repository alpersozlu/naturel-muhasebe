import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Z raporu onay kuralı — kullanıcının iş kuralı:
 *
 *   Toplam Z = Z.net_sales_try + Σ(ManualInvoice.amount_try)
 *
 *   Alt sınır (Z bu rakamın ALTINA inemez):
 *     - Nakit varsa: Toplam Z ≥ Visa × 1.05
 *     - Nakit yoksa: Toplam Z ≥ Visa  (eşit olabilir)
 *
 *   Üst sınır:
 *     - Toplam Z ≤ StoreSummary.sales_total_try  (toplam satıştan fazla olamaz)
 *
 * KK eşik kaynağı: aynı daily_record altındaki PARSED/CONFIRMED POS
 * sliplerinin net_amount_try toplamı.
 *
 * En kritik kural: Z hiçbir zaman Visa'nın ALTINDA olmamalı.
 * Z = Visa + Nakit olmalı (yaklaşık), Z + Cash = Total Sales.
 */

export type ZApprovalCheck = {
  passed: boolean;
  reasons: string[]; // boş ise tüm kurallar geçti
  combined: number; // Z + manual invoices
  cc_total: number;
  /** Alt sınır: Visa veya Visa × 1.05 (nakit varsa) */
  cc_floor: number | null;
  total_sales: number | null;
  /** Nakit > 0 → 5% cushion uygulanıyor mu */
  cash_present: boolean;
};

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

export async function checkZApproval(
  prisma: PrismaClient,
  uploadId: string
): Promise<ZApprovalCheck | null> {
  const z = await prisma.zReport.findUnique({
    where: { upload_id: uploadId },
    include: {
      daily_record: {
        include: {
          store_summary: true,
          manual_invoices: true,
          pos_slips: { include: { upload: { select: { status: true } } } },
        },
      },
    },
  });
  if (!z) return null;

  const net_z = num(z.net_sales_try);
  const invoicesSum = z.daily_record.manual_invoices.reduce(
    (s, inv) => s + num(inv.amount_try),
    0
  );
  const combined = net_z + invoicesSum;

  // KK eşiği: POS slipleri toplamı (parsed/confirmed olanlar). Z'den KK okunmaz.
  const cc_total = z.daily_record.pos_slips
    .filter((p) => p.upload.status === "parsed" || p.upload.status === "confirmed")
    .reduce((s, p) => s + num(p.net_amount_try), 0);

  // Nakit varsa Toplam Z'in alt sınırı Visa × 1.05; yoksa direkt Visa.
  const cashSales = z.daily_record.store_summary
    ? num(z.daily_record.store_summary.cash_sales_try)
    : 0;
  const cashPresent = cashSales > 0.01;
  const cc_floor =
    cc_total > 0 ? (cashPresent ? cc_total * 1.05 : cc_total) : null;

  const total_sales = z.daily_record.store_summary
    ? num(z.daily_record.store_summary.sales_total_try)
    : null;

  const reasons: string[] = [];

  // 1. Alt sınır kontrolü — Z, Visa'nın altında olamaz.
  if (cc_floor !== null && combined < cc_floor) {
    if (cashPresent) {
      reasons.push(
        `Toplam Z (${TRY_FMT.format(combined)} ₺) Visa'nın %5 üstünde olmalı — gerekli en az: ${TRY_FMT.format(
          cc_floor
        )} ₺ (Visa ${TRY_FMT.format(cc_total)} ₺ × 1.05).`
      );
    } else {
      reasons.push(
        `Toplam Z (${TRY_FMT.format(combined)} ₺) Visa'nın altında olamaz — Visa: ${TRY_FMT.format(
          cc_total
        )} ₺. Nakit olmadığı için Z en az Visa kadar olmalı.`
      );
    }
  } else if (cc_floor === null) {
    reasons.push(
      "Henüz POS fişi yüklenmedi — Z alt sınırı (Visa eşiği) hesaplanamıyor. POS fişlerini yükleyince tekrar değerlendirilecek."
    );
  }

  // 2. Üst sınır kontrolü — Z, toplam satıştan fazla olamaz.
  if (total_sales !== null && combined > total_sales) {
    reasons.push(
      `Toplam Z (${TRY_FMT.format(combined)} ₺) Mağaza Özeti'ndeki toplam satıştan (${TRY_FMT.format(
        total_sales
      )} ₺) fazla olamaz.`
    );
  } else if (total_sales === null) {
    reasons.push(
      "Mağaza Özeti henüz yüklenmedi — üst sınır (toplam satış) kontrolü Mağaza Özeti yüklendiğinde tekrar değerlendirilecek."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    combined,
    cc_total,
    cc_floor,
    total_sales,
    cash_present: cashPresent,
  };
}
