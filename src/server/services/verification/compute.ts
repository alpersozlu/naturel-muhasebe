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
  const drInclude = {
    pos_slips: { include: { upload: { select: { status: true } } } },
    store_summary: true,
    z_reports: { select: { net_sales_try: true } },
    manual_invoices: { select: { amount_try: true } },
    dealer_daily_report: true,
    bank_receipts: { select: { amount_try: true } },
    expenses: { select: { amount_try: true } },
    cash_advances: { select: { amount_try: true } },
  } as const;

  const base = await prisma.dailyRecord.findUnique({
    where: { id: dailyRecordId },
    select: { id: true, merge_group_id: true, cumulative_prev_id: true },
  });
  if (!base) {
    return {
      rows: [],
      expected_total: 0,
      actual_total: 0,
      difference: 0,
      status: "no_data",
      notes: "Gün kaydı bulunamadı",
    };
  }

  // Gün birleşmesi: grup varsa TÜM günlerin belgelerini topla, tek özetle kıyasla.
  const isMerge = base.merge_group_id !== null;
  const records = isMerge
    ? await prisma.dailyRecord.findMany({
        where: { merge_group_id: base.merge_group_id },
        orderBy: { date: "asc" },
        include: drInclude,
      })
    : await prisma.dailyRecord.findMany({
        where: { id: dailyRecordId },
        include: drInclude,
      });

  // ── Belge toplamları (tüm günler boyunca) ──
  const includedPos = records
    .flatMap((r) => r.pos_slips)
    .filter((p) => p.upload.status === "parsed" || p.upload.status === "confirmed");
  const posSumTRY = includedPos.reduce((s, p) => s + num(p.net_amount_try), 0);

  // Özet: merge'de son günde, tek günde kendi gününde
  const summary =
    records.find((r) => r.store_summary !== null)?.store_summary ?? null;

  if (!summary) {
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
      notes: isMerge
        ? "Birleşmenin son gününe Mağaza Özeti henüz yüklenmedi"
        : "Mağaza Özeti henüz yüklenmedi",
    };
  }

  // ── Kümülatif kasa birleşmesi (Mavi) ──
  // Bu günün özeti önceki günün satışlarını da içeriyorsa (kasa kapatılmadı),
  // gerçek bugün = bu özet − önceki gün özeti. Derimod merge'den ayrı; sadece
  // tek-gün akışında geçerli (merge grubu yoksa).
  let prevSummary: {
    sales_total_try: { toNumber: () => number } | null;
    cash_sales_try: { toNumber: () => number } | null;
    credit_card_total_try: { toNumber: () => number } | null;
    loyalty_points_total_try: { toNumber: () => number } | null;
    wire_transfer_total_try: { toNumber: () => number } | null;
  } | null = null;
  if (!isMerge && base.cumulative_prev_id) {
    const prev = await prisma.dailyRecord.findUnique({
      where: { id: base.cumulative_prev_id },
      select: {
        store_summary: {
          select: {
            sales_total_try: true,
            cash_sales_try: true,
            credit_card_total_try: true,
            loyalty_points_total_try: true,
            wire_transfer_total_try: true,
          },
        },
      },
    });
    prevSummary = prev?.store_summary ?? null;
  }
  const sub = (
    a: { toNumber: () => number } | null | undefined,
    b: { toNumber: () => number } | null | undefined
  ) => num(a) - num(b);

  const summaryCash = prevSummary
    ? sub(summary.cash_sales_try, prevSummary.cash_sales_try)
    : num(summary.cash_sales_try);
  const loyalty = prevSummary
    ? sub(summary.loyalty_points_total_try, prevSummary.loyalty_points_total_try)
    : num(summary.loyalty_points_total_try);
  const ccTotal = prevSummary
    ? sub(summary.credit_card_total_try, prevSummary.credit_card_total_try)
    : num(summary.credit_card_total_try);
  const summaryWire = prevSummary
    ? sub(summary.wire_transfer_total_try, prevSummary.wire_transfer_total_try)
    : num(summary.wire_transfer_total_try);
  const summarySales = prevSummary
    ? sub(summary.sales_total_try, prevSummary.sales_total_try)
    : num(summary.sales_total_try);

  // Müdürün elden saydığı nakit — tüm günlerin toplamı (en az biri girdiyse).
  const reportedCashRaw = records.reduce(
    (s, r) => s + (r.reported_cash_try ? num(r.reported_cash_try) : 0),
    0
  );
  const anyReportedCash = records.some((r) => r.reported_cash_try !== null);
  const reportedCash = anyReportedCash ? reportedCashRaw : null;

  // ── Nakit kaynak bileşenleri ──
  // İki senaryo:
  //   A) Özette Havale AYRI kalem (summaryWire > tol) → dekontlar havaleyi
  //      karşılar, nakit denkleminden HARİÇ.
  //   B) Özette Havale yok (0) → dekontlar cash_sales içine işlenmiş demek,
  //      nakit kaynaklarına EKLE.
  const bankReceiptTotal = records
    .flatMap((r) => r.bank_receipts)
    .reduce((s, b) => s + num(b.amount_try), 0);
  const expenseTotal = records
    .flatMap((r) => r.expenses)
    .reduce((s, e) => s + num(e.amount_try), 0);
  const cashAdvanceTotal = records
    .flatMap((r) => r.cash_advances)
    .reduce(
    (s, c) => s + num(c.amount_try),
    0
  );
  const masrafToplam = expenseTotal + cashAdvanceTotal;
  const giftVoucherTotal = records.reduce(
    (s, r) => s + (r.gift_voucher_try ? num(r.gift_voucher_try) : 0),
    0
  );

  const wireIsSeparate = summaryWire > TOLERANCE_TL;
  const cashSourcesTotal =
    (reportedCash ?? 0) +
    (wireIsSeparate ? 0 : bankReceiptTotal) +
    masrafToplam +
    giftVoucherTotal;

  // GENEL TOPLAM denklemi: elime geçen belge toplamı ↔ özetin sales_total'i
  //   docs = POS + nakit kaynakları + loyalty + (havale ayrıysa dekont)
  //   summary = özet.sales_total
  // Sign konvansiyonu: docs − summary
  //   negatif = belge az = eksik (kayıp/hırsızlık sinyali)
  //   pozitif = belge fazla
  const expected_total =
    posSumTRY +
    cashSourcesTotal +
    loyalty +
    (wireIsSeparate ? bankReceiptTotal : 0);
  const actual_total = summarySales;
  const difference = expected_total - actual_total;

  // Z compliance — Toplam Z (Z Raporu + El Faturası), tüm günler boyunca
  const zReportTotal = records
    .flatMap((r) => r.z_reports)
    .reduce((s, z) => s + num(z.net_sales_try), 0);
  const manualInvoiceTotal = records
    .flatMap((r) => r.manual_invoices)
    .reduce((s, m) => s + num(m.amount_try), 0);
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
    // Nakit denklemi:
    //   Hediye Çeki + Masraf + Sayım [+ Dekont (havale ayrı değilse)] = Özet Nakit
    // Kaynak yoksa ve özet nakit > 0 ise eksik (kayıp sinyali).
    {
      label: wireIsSeparate
        ? "Nakit Kaynakları (Hediye + Masraf + Sayım)"
        : "Nakit Kaynakları (Hediye + Masraf + Sayım + Dekont)",
      document_total: cashSourcesTotal,
      summary_total: summaryCash,
      difference: cashSourcesTotal - summaryCash,
      matches: Math.abs(cashSourcesTotal - summaryCash) <= TOLERANCE_TL,
      cash_breakdown: {
        gift_voucher: giftVoucherTotal,
        expenses: masrafToplam,
        reported_cash: reportedCash ?? 0,
        // Havale ayrı satırda gösteriliyorsa burada tekrar listeleme
        bank_receipts: wireIsSeparate ? 0 : bankReceiptTotal,
        has_reported_cash: reportedCash !== null,
        has_bank_receipt: !wireIsSeparate && bankReceiptTotal > 0,
        has_gift_voucher: giftVoucherTotal > 0,
        has_expenses: masrafToplam > 0,
      },
    },
    // Havale satırı — sadece özette havale ayrı kalem ise göster.
    // (Havale yoksa dekont zaten nakit kaynaklarına eklendi.)
    ...(wireIsSeparate
      ? [
          {
            label: "Havale (İban Dekontu)",
            document_total: bankReceiptTotal,
            summary_total: summaryWire,
            difference: bankReceiptTotal - summaryWire,
            matches: Math.abs(bankReceiptTotal - summaryWire) <= TOLERANCE_TL,
          } as ComparisonRow,
        ]
      : []),
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
  // (Sadece tek-gün Mavi akışında; Derimod birleşmesinde SAP yoktur.)
  const sapReport =
    records.find((r) => r.dealer_daily_report !== null)?.dealer_daily_report ??
    null;
  if (sapReport) {
    const sapNet = num(sapReport.net_sales_try);
    const sapLoyalty = num(sapReport.loyalty_try);
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
  // Dekont nakit kaynağı sayılır mı? Havale ayrı kalem ise HAYIR.
  const dekontCountsAsCash = !wireIsSeparate && bankReceiptTotal > 0;
  const noCashSource =
    summaryCash > TOLERANCE_TL &&
    reportedCash === null &&
    !dekontCountsAsCash &&
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
