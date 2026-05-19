import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Z raporu onay kuralı — kullanıcının iş kuralı:
 *
 *   1. Z.net_sales_try + Σ(ManualInvoice.amount_try) ≤ Z.credit_card_sales_try × 1.05
 *   2. Z.net_sales_try + Σ(ManualInvoice.amount_try) < StoreSummary.sales_total_try
 *
 * İkisi de sağlanırsa Z onaylanabilir. Mağaza Özeti yüklenmemişse 2.
 * koşul "uygulanamaz" (passed = neutral) sayılır ve uyarı verilir.
 */

export type ZApprovalCheck = {
  passed: boolean;
  reasons: string[]; // boş ise tüm kurallar geçti
  combined: number;
  cc_threshold: number | null;
  total_sales: number | null;
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
        include: { store_summary: true, manual_invoices: true },
      },
    },
  });
  if (!z) return null;

  const net_z = num(z.net_sales_try);
  const cc_z = num(z.credit_card_sales_try);
  const invoicesSum = z.daily_record.manual_invoices.reduce(
    (s, inv) => s + num(inv.amount_try),
    0
  );
  const combined = net_z + invoicesSum;

  const cc_threshold = cc_z > 0 ? cc_z * 1.05 : null;
  const total_sales = z.daily_record.store_summary
    ? num(z.daily_record.store_summary.sales_total_try)
    : null;

  const reasons: string[] = [];

  if (cc_threshold !== null && combined > cc_threshold) {
    reasons.push(
      `Z + El faturaları (${TRY_FMT.format(combined)} ₺) kredi kartı toplamının %5 üstünden fazla (sınır: ${TRY_FMT.format(
        cc_threshold
      )} ₺).`
    );
  } else if (cc_threshold === null) {
    reasons.push("Z raporunda kredi kartı toplamı okunamadı.");
  }

  if (total_sales !== null && combined >= total_sales) {
    reasons.push(
      `Z + El faturaları (${TRY_FMT.format(combined)} ₺) Mağaza Özeti'ndeki toplam satıştan (${TRY_FMT.format(
        total_sales
      )} ₺) az olmalı.`
    );
  } else if (total_sales === null) {
    reasons.push(
      "Mağaza Özeti henüz yüklenmedi — bu kontrol Mağaza Özeti yüklendiğinde tekrar değerlendirilecek."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    combined,
    cc_threshold,
    total_sales,
  };
}
