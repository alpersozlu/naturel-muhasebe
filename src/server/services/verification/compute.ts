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

  const cash = num(dr.store_summary.cash_sales_try);
  const loyalty = num(dr.store_summary.loyalty_points_total_try);
  const ccTotal = num(dr.store_summary.credit_card_total_try);
  const summarySales = num(dr.store_summary.sales_total_try);

  const expected_total = posSumTRY + cash + loyalty;
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
    {
      label: "Nakit Satışlar",
      document_total: cash,
      summary_total: cash,
      difference: 0,
      matches: true, // doğrudan rapordan
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

  return {
    rows,
    expected_total,
    actual_total,
    difference,
    status,
    notes:
      status === "match"
        ? null
        : `Fark ${difference.toFixed(2)} TL (tolerans ±${TOLERANCE_TL} TL)`,
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
