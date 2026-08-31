import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Z raporu onay kuralı — kullanıcının iş kuralı:
 *
 *   Toplam Z = Z.net_sales_try + Σ(ManualInvoice.amount_try)
 *
 *   KESİN alt sınır (asla onaylanmaz):
 *     - Toplam Z ≥ Visa   → Z, Visa'nın ALTINDA olamaz. İstisnası yoktur.
 *
 *   UYARI eşiği (onayı engellemez):
 *     - Nakit varsa Toplam Z'in Visa × 1.05'i geçmesi beklenir. Z ile Visa
 *       eşit/çok yakınsa kayıt yine de onaylanır ama uyarı düşer — nakit
 *       satış varken Z'in Visa'ya eşit çıkması olağan değildir, kontrol
 *       edilmesi istenir.
 *
 *   Üst sınır:
 *     - Toplam Z ≤ StoreSummary.sales_total_try  (toplam satıştan fazla olamaz)
 *
 * KK eşik kaynağı: aynı daily_record altındaki PARSED/CONFIRMED POS
 * sliplerinin net_amount_try toplamı.
 */

export type ZApprovalCheck = {
  passed: boolean;
  reasons: string[]; // ENGELLEYİCİ — boş ise onaylanabilir
  /** Onayı engellemeyen ama gösterilmesi gereken uyarılar */
  warnings: string[];
  combined: number; // Z + manual invoices
  cc_total: number;
  /** KESİN alt sınır = Visa. Bunun altı asla onaylanmaz. */
  cc_hard_floor: number | null;
  /** Beklenen alt sınır: nakit varsa Visa × 1.05, yoksa Visa. */
  cc_floor: number | null;
  total_sales: number | null;
  /** Nakit > 0 → 5% cushion BEKLENİYOR (zorunlu değil) */
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

  const cashSales = z.daily_record.store_summary
    ? num(z.daily_record.store_summary.cash_sales_try)
    : 0;
  const cashPresent = cashSales > 0.01;
  // KESİN sınır her zaman Visa'dır. %5 payı yalnız BEKLENTİdir (uyarı).
  const cc_hard_floor = cc_total > 0 ? cc_total : null;
  const cc_floor =
    cc_total > 0 ? (cashPresent ? cc_total * 1.05 : cc_total) : null;

  const total_sales = z.daily_record.store_summary
    ? num(z.daily_record.store_summary.sales_total_try)
    : null;

  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. KESİN alt sınır — Z, Visa'nın altında olamaz (istisnasız).
  if (cc_hard_floor !== null && combined < cc_hard_floor) {
    reasons.push(
      `Toplam Z (${TRY_FMT.format(combined)} ₺) Visa'nın ALTINDA olamaz — Visa: ${TRY_FMT.format(
        cc_total
      )} ₺. Bu kuralın istisnası yoktur.`
    );
  } else if (cc_floor !== null && combined < cc_floor) {
    // Visa ile Visa×1.05 arasında: onaylanır, ama nakit varken Z'in Visa'ya
    // bu kadar yakın olması beklenmez — uyarı düşür.
    warnings.push(
      `Nakit satış var ama Toplam Z (${TRY_FMT.format(
        combined
      )} ₺) Visa'ya çok yakın. Beklenen en az ${TRY_FMT.format(
        cc_floor
      )} ₺ (Visa ${TRY_FMT.format(
        cc_total
      )} ₺ × 1.05). Onaylandı — nakit satışın Z'e işlendiğini kontrol et.`
    );
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
    warnings,
    combined,
    cc_total,
    cc_hard_floor,
    cc_floor,
    total_sales,
    cash_present: cashPresent,
  };
}
