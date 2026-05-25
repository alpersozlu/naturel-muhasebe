import "server-only";
import type { PrismaClient } from "@prisma/client";
import { TOLERANCE_TL } from "@/lib/constants";

export type ComparisonRow = {
  label: string;
  document_total: number; // Yüklenmiş belgelerden toplam (TRY)
  summary_total: number; // Mağaza Özeti'nden ilgili kalem (TRY)
  difference: number;
  matches: boolean;
  /** Z compliance satırı için ek meta — UI farklı badge gösterir */
  z_compliance?: {
    status: "passed" | "below_visa" | "above_sales" | "no_z";
    z_report_total: number;
    manual_invoice_total: number;
    visa_total: number;
    visa_floor: number;
    sales_ceiling: number;
    cash_present: boolean;
  };
  /** Nakit satırı için bileşim — UI alt satırda detay gösterir */
  cash_breakdown?: {
    gift_voucher: number;
    expenses: number;
    reported_cash: number;
    bank_receipts: number;
    has_reported_cash: boolean;
    has_bank_receipt: boolean;
    has_gift_voucher: boolean;
    has_expenses: boolean;
  };
};

export type DayComputeResult = {
  /** Eşleşmeli/karşılaştırmalı satırlar */
  rows: ComparisonRow[];
  /** Belge toplamı (Σ POS NET + Nakit + Kartuş) — TRY */
  expected_total: number;
  /** Mağaza Özeti sales_total — TRY */
  actual_total: number;
  /** actual − expected (≈0 ise eşleşme) */
  difference: number;
  /** Genel durum: hepsi tutuyorsa match, en az biri tutmuyorsa mismatch, mağaza özeti yoksa no_data */
  status: "match" | "mismatch" | "no_data" | "no_summary";
  /** Tolerans uygulanmadan önce ham fark detayı */
  notes: string | null;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

/**
 * Compute verification for one day.
 *
 * Algorithm:
 *   expected = Σ(PosSlip.net_amount_try) + StoreSummary.cash_sales_try + StoreSummary.loyalty_points_total_try
 *   actual   = StoreSummary.sales_total_try
 *   match iff |actual − expected| ≤ TOLERANCE_TL
 *
 * Only POS slips whose parent Upload status is 'parsed' or 'confirmed' count
 * (failed uploads are skipped, draft excluded).
 */
export async function computeDay(
  prisma: PrismaClient,
  dailyRecordId: string
): Promise<DayComputeResult> {
  const dr = await prisma.dailyRecord.findUnique({
    where: { id: dailyRecordId },
    include: {
      pos_slips: { include: { upload: { select: { status: true } } } },
      store_summary: true,
      z_reports: { select: { net_sales_try: true } },
      manual_invoices: { select: { amount_try: true } },
      dealer_daily_report: true,
      // Nakit denklemi için ek kaynaklar:
      bank_receipts: { select: { amount_try: true } },
      expenses: { select: { amount_try: true } },
      cash_advances: { select: { amount_try: true } },
    },
  });
  if (!dr) {
    return {
      rows: [],
      expected_total: 0,
      actual_total: 0,
      difference: 0,
      status: "no_data",
      notes: "Gün kaydı bulunamadı",
    };
  }

  const includedPos = dr.pos_slips.filter(
    (p) => p.upload.status === "parsed" || p.upload.status === "confirmed"
  );
  const posSumTRY = includedPos.reduce((s, p) => s + num(p.net_amount_try), 0);

  if (!dr.store_summary) {
    return {
      rows: [
        {
          label: "POS Toplamı (TRY)",
          document_total: posSumTRY,
          summary_total: 0,
          difference: -posSumTRY,
          matches: false,
        },
      ],
      expected_total: posSumTRY,
      actual_total: 0,
      difference: -posSumTRY,
      status: "no_summary",
      notes: "Mağaza Özeti henüz yüklenmedi",
    };
  }

  const summaryCash = num(dr.store_summary.cash_sales_try);
  const loyalty = num(dr.store_summary.loyalty_points_total_try);
  const ccTotal = num(dr.store_summary.credit_card_total_try);
  const summarySales = num(dr.store_summary.sales_total_try);

  // Müdürün elden saydığı nakit (varsa).
  const reportedCash = dr.reported_cash_try ? num(dr.reported_cash_try) : null;

  // ── Nakit kaynak bileşenleri (yeni denklem) ──
  // hediye_ceki + masraf + (sayım + dekont) = summaryCash
  const bankReceiptTotal = dr.bank_receipts.reduce(
    (s, b) => s + num(b.amount_try),
    0
  );
  const expenseTotal = dr.expenses.reduce((s, e) => s + num(e.amount_try), 0);
  const cashAdvanceTotal = dr.cash_advances.reduce(
    (s, c) => s + num(c.amount_try),
    0
  );
  const masrafToplam = expenseTotal + cashAdvanceTotal;
  const giftVoucherTotal = dr.gift_voucher_try ? num(dr.gift_voucher_try) : 0;
  const cashSourcesTotal =
    (reportedCash ?? 0) + bankReceiptTotal + masrafToplam + giftVoucherTotal;

  // GENEL TOPLAM denklemi: elime geçen belge toplamı ↔ özetin sales_total'i
  //   docs = POS + (girilen nakit kaynakları) + loyalty
  //   summary = özet.sales_total
  // Sign konvansiyonu: docs − summary
  //   negatif = belge az = eksik (kayıp/hırsızlık sinyali)
  //   pozitif = belge fazla
  const expected_total = posSumTRY + cashSourcesTotal + loyalty;
  const actual_total = summarySales;
  const difference = expected_total - actual_total;

  // Z compliance — Toplam Z (Z Raporu + El Faturası)
  const zReportTotal = dr.z_reports.reduce(
    (s, z) => s + num(z.net_sales_try),
    0
  );
  const manualInvoiceTotal = dr.manual_invoices.reduce(
    (s, m) => s + num(m.amount_try),
    0
  );
  const combinedZ = zReportTotal + manualInvoiceTotal;
  // Visa floor için "nakit dönüyor mu" sorusu: özet nakit > tolerans → evet
  const cashPresent = summaryCash > TOLERANCE_TL;
  const visaFloor =
    posSumTRY > 0 ? (cashPresent ? posSumTRY * 1.05 : posSumTRY) : 0;
  const salesCeiling = summarySales;

  let zStatus: "passed" | "below_visa" | "above_sales" | "no_z";
  if (combinedZ <= TOLERANCE_TL) {
    zStatus = "no_z";
  } else if (visaFloor > 0 && combinedZ < visaFloor - TOLERANCE_TL) {
    zStatus = "below_visa";
  } else if (salesCeiling > 0 && combinedZ > salesCeiling + TOLERANCE_TL) {
    zStatus = "above_sales";
  } else {
    zStatus = "passed";
  }

  // Satır satır karşılaştırma (UI için) — aynı konvansiyon: doc − summary
  const rows: ComparisonRow[] = [
    {
      label: "POS Fişleri Toplamı",
      document_total: posSumTRY,
      summary_total: ccTotal,
      difference: posSumTRY - ccTotal,
      matches: Math.abs(posSumTRY - ccTotal) <= TOLERANCE_TL,
    },
    // Yeni nakit denklemi:
    //   Hediye Çeki + Masraf + (Sayım + Dekont) = Özet Nakit
    // Kaynak yoksa ve özet nakit > 0 ise eksik (kayıp sinyali).
    {
      label: "Nakit Kaynakları (Hediye + Masraf + Sayım + Dekont)",
      document_total: cashSourcesTotal,
      summary_total: summaryCash,
      difference: cashSourcesTotal - summaryCash,
      matches: Math.abs(cashSourcesTotal - summaryCash) <= TOLERANCE_TL,
      cash_breakdown: {
        gift_voucher: giftVoucherTotal,
        expenses: masrafToplam,
        reported_cash: reportedCash ?? 0,
        bank_receipts: bankReceiptTotal,
        has_reported_cash: reportedCash !== null,
        has_bank_receipt: bankReceiptTotal > 0,
        has_gift_voucher: giftVoucherTotal > 0,
        has_expenses: masrafToplam > 0,
      },
    },
    {
      label: "Kartuş Puan",
      document_total: loyalty,
      summary_total: loyalty,
      difference: 0,
      matches: true,
    },
    {
      label:
        zReportTotal > 0 && manualInvoiceTotal > 0
          ? "Toplam Z (Z Raporu + El Faturası)"
          : zReportTotal > 0
            ? "Z Raporu"
            : manualInvoiceTotal > 0
              ? "El Faturası (Z yerine)"
              : "Toplam Z",
      document_total: combinedZ,
      // Reference olarak Visa eşiği — alt sınır
      summary_total: visaFloor,
      // Pozitif = Visa üstünde (sağlıklı), negatif = altta
      difference: combinedZ - visaFloor,
      matches: zStatus === "passed",
      z_compliance: {
        status: zStatus,
        z_report_total: zReportTotal,
        manual_invoice_total: manualInvoiceTotal,
        visa_total: posSumTRY,
        visa_floor: visaFloor,
        sales_ceiling: salesCeiling,
        cash_present: cashPresent,
      },
    },
    {
      label: "GENEL TOPLAM",
      document_total: expected_total,
      summary_total: actual_total,
      difference,
      matches: Math.abs(difference) <= TOLERANCE_TL,
    },
  ];

  // ── SAP Bayi Raporu satırları (varsa) ──
  // Ham SAP verisi mağaza özeti ile karşılaştırılır — manipülasyon tespiti.
  if (dr.dealer_daily_report) {
    const sapNet = num(dr.dealer_daily_report.net_sales_try);
    const sapLoyalty = num(dr.dealer_daily_report.loyalty_try);
    const netDiff = sapNet - summarySales; // SAP − özet (negatif = özet daha yüksek)
    const loyDiff = sapLoyalty - loyalty;
    rows.splice(rows.length - 1, 0, {
      label: "SAP Net Satış (Bayi Raporu)",
      document_total: sapNet,
      summary_total: summarySales,
      difference: netDiff,
      matches: Math.abs(netDiff) <= TOLERANCE_TL,
    });
    rows.splice(rows.length - 1, 0, {
      label: "SAP Kartuş Puan (Bayi Raporu)",
      document_total: sapLoyalty,
      summary_total: loyalty,
      difference: loyDiff,
      matches: Math.abs(loyDiff) <= TOLERANCE_TL,
    });
  }

  const status: DayComputeResult["status"] = rows[rows.length - 1].matches
    ? "match"
    : "mismatch";

  // Nakit kaynak uyarısı.
  // Yeni denklem: Hediye + Masraf + (Sayım + Dekont) ↔ Özet Nakit
  // cashSourcesTotal − summaryCash: negatif = kaynak az (eksik/kayıp), pozitif = fazla
  const fmtTL = (n: number) =>
    n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cashRow = rows[1];
  const noCashSource =
    summaryCash > TOLERANCE_TL &&
    reportedCash === null &&
    bankReceiptTotal === 0 &&
    giftVoucherTotal === 0 &&
    masrafToplam === 0;
  const cashMismatch = noCashSource
    ? `Özette ${fmtTL(summaryCash)} ₺ nakit satış var ama hiçbir kaynak girilmemiş (sayım/dekont/hediye/masraf). Lütfen en az birini ekleyin.`
    : !cashRow.matches
      ? cashRow.difference < 0
        ? `Nakit eksik: Kaynaklar ${fmtTL(cashSourcesTotal)} ₺, özette ${fmtTL(summaryCash)} ₺ → ${fmtTL(Math.abs(cashRow.difference))} ₺ kayıp riski.`
        : `Nakit fazla: Kaynaklar ${fmtTL(cashSourcesTotal)} ₺, özette ${fmtTL(summaryCash)} ₺ → ${fmtTL(cashRow.difference)} ₺ fazla.`
      : null;

  const noteParts: string[] = [];
  if (cashMismatch) noteParts.push(cashMismatch);
  if (status !== "match") {
    noteParts.push(
      `Genel fark ${fmtTL(difference)} ₺ (tolerans ±${TOLERANCE_TL} ₺).`
    );
  }

  return {
    rows,
    expected_total,
    actual_total,
    difference,
    status,
    notes: noteParts.length > 0 ? noteParts.join(" ") : null,
  };
}

/** Persist verification result to DB (upsert by daily_record_id). */
export async function persistVerification(
  prisma: PrismaClient,
  dailyRecordId: string,
  result: DayComputeResult
): Promise<void> {
  if (result.status === "no_data") return;

  await prisma.verification.upsert({
    where: { daily_record_id: dailyRecordId },
    update: {
      expected_total: result.expected_total,
      actual_total: result.actual_total,
      difference: result.difference,
      status:
        result.status === "match"
          ? "match"
          : result.status === "mismatch"
            ? "mismatch"
            : "mismatch", // no_summary → mismatch (eksik veri)
      notes: result.notes,
    },
    create: {
      daily_record_id: dailyRecordId,
      expected_total: result.expected_total,
      actual_total: result.actual_total,
      difference: result.difference,
      status: result.status === "match" ? "match" : "mismatch",
      notes: result.notes,
    },
  });
}
