import "server-only";
import type { PrismaClient } from "@prisma/client";
import { TOLERANCE_TL } from "@/lib/constants";

export type ComparisonRow = {
  label: string;
  document_total: number; // Yüklenmiş belgelerden toplam (TRY)
  summary_total: number; // Mağaza Özeti'nden ilgili kalem (TRY)
  difference: number;
  matches: boolean;
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

  // Müdürün elden saydığı nakit (varsa). Yoksa fallback: store summary cash.
  const reportedCash = dr.reported_cash_try ? num(dr.reported_cash_try) : null;
  const effectiveCash = reportedCash ?? summaryCash;

  const expected_total = posSumTRY + effectiveCash + loyalty;
  const actual_total = summarySales;
  const difference = actual_total - expected_total;

  // Satır satır karşılaştırma (UI için)
  const rows: ComparisonRow[] = [
    {
      label: "POS Fişleri Toplamı",
      document_total: posSumTRY,
      summary_total: ccTotal,
      difference: ccTotal - posSumTRY,
      matches: Math.abs(ccTotal - posSumTRY) <= TOLERANCE_TL,
    },
    // Müdür nakit girişi varsa kasa karşılaştırması yap; aksi halde tek satır.
    reportedCash !== null
      ? {
          label: "Nakit (Müdür sayımı vs Mağaza özeti)",
          document_total: reportedCash,
          summary_total: summaryCash,
          difference: summaryCash - reportedCash,
          matches: Math.abs(summaryCash - reportedCash) <= TOLERANCE_TL,
        }
      : {
          label: "Nakit (yalnızca özet, müdür sayımı yok)",
          document_total: summaryCash,
          summary_total: summaryCash,
          difference: 0,
          matches: true,
        },
    {
      label: "Kartuş Puan",
      document_total: loyalty,
      summary_total: loyalty,
      difference: 0,
      matches: true,
    },
    {
      label: "GENEL TOPLAM",
      document_total: expected_total,
      summary_total: actual_total,
      difference,
      matches: Math.abs(difference) <= TOLERANCE_TL,
    },
  ];

  const status: DayComputeResult["status"] = rows[rows.length - 1].matches
    ? "match"
    : "mismatch";

  // Kasa eksiklik/fazlalık uyarısı (müdür nakit girişi varsa)
  const cashRow = rows[1];
  const cashMismatch =
    reportedCash !== null && !cashRow.matches
      ? cashRow.difference > 0
        ? `Kasa eksiklik: Müdür ${reportedCash.toFixed(2)} TL saydı ama özette ${summaryCash.toFixed(2)} TL → ${cashRow.difference.toFixed(2)} TL eksik (potansiyel kayıp).`
        : `Kasa fazlalık: Müdür ${reportedCash.toFixed(2)} TL saydı ama özette ${summaryCash.toFixed(2)} TL → ${Math.abs(cashRow.difference).toFixed(2)} TL fazla.`
      : null;

  const noteParts: string[] = [];
  if (cashMismatch) noteParts.push(cashMismatch);
  if (status !== "match") {
    noteParts.push(
      `Genel fark ${difference.toFixed(2)} TL (tolerans ±${TOLERANCE_TL} TL).`
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
