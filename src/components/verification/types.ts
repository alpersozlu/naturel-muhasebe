import type { OptimumShare } from "@/lib/optimum-share";

/** verification.listForMonth satırı — Doğrulama Sistemi gün kartlarının verisi. */
export type DayRecord = {
  id: string;
  date: Date | string;
  status: "draft" | "pending" | "approved" | "locked";
  store_summary: {
    sales_total_try: unknown;
    loyalty_points_total_try?: unknown;
  } | null;
  dealer_daily_report?: {
    net_sales_try: unknown;
    loyalty_try: unknown;
  } | null;
  store?: { brand: { name: string } };
  verification: {
    expected_total: unknown;
    actual_total: unknown;
    difference: unknown;
    status: "match" | "mismatch" | "manual_override";
  } | null;
  merge_group_id?: string | null;
  merge_index?: number | null;
  /** Optimum payı (sahibi, 29.10.2026) — düşükse amber rozet. */
  optimum?: OptimumShare | null;
  _count: {
    pos_slips: number;
    bank_receipts: number;
    expenses: number;
    cash_advances: number;
    z_reports?: number;
  };
};

// Prisma Decimal tRPC üzerinden string'e serialize edilir — client'ta
// .toNumber() çağrılamaz. Decimal nesnesi, string ve number desteklenir.
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmt(n: number): string {
  return TRY_FORMATTER.format(n);
}

export function dayOf(r: DayRecord): number {
  return new Date(r.date).getUTCDate();
}

export const WEEKDAYS_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"] as const;

export function weekdayOf(year: number, month: number, day: number): string {
  return WEEKDAYS_TR[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/** Günün belge sayıları — rozet listesi için. */
export type DocPiece = { key: "z" | "pos" | "iban" | "expense" | "advance" | "summary" | "sap"; label: string; count?: number };

export function docPiecesOf(r: DayRecord): DocPiece[] {
  const p: DocPiece[] = [];
  if ((r._count.z_reports ?? 0) > 0) p.push({ key: "z", label: "Z", count: r._count.z_reports });
  if (r._count.pos_slips > 0) p.push({ key: "pos", label: "POS", count: r._count.pos_slips });
  if (r._count.bank_receipts > 0) p.push({ key: "iban", label: "İban", count: r._count.bank_receipts });
  if (r._count.expenses > 0) p.push({ key: "expense", label: "Masraf", count: r._count.expenses });
  if (r._count.cash_advances > 0) p.push({ key: "advance", label: "Peşin", count: r._count.cash_advances });
  if (r.store_summary) p.push({ key: "summary", label: "Özet" });
  if (r.dealer_daily_report) p.push({ key: "sap", label: "SAP" });
  return p;
}

export function docCountOf(days: DayRecord[]): number {
  return days.reduce(
    (n, d) =>
      n +
      d._count.pos_slips +
      d._count.bank_receipts +
      d._count.expenses +
      d._count.cash_advances +
      (d._count.z_reports ?? 0) +
      (d.store_summary ? 1 : 0),
    0
  );
}

/** 3. Aşama: SAP Bayi Raporu kontrolü (Mavi mağazalar için zorunlu). */
export function checkThirdStage(record: DayRecord): { ok: boolean; reason: string | null } {
  const brandName = record.store?.brand.name?.toLocaleLowerCase("tr") ?? "";
  const isMavi = brandName.includes("mavi");
  if (!isMavi) return { ok: true, reason: null };

  if (!record.dealer_daily_report) {
    return {
      ok: false,
      reason: "3. Aşama: Bayi Gün Sonu (SAP) raporu yüklenmemiş — Mavi mağazalarda zorunlu",
    };
  }
  const TOL = 5;
  const sapNet = num(record.dealer_daily_report.net_sales_try);
  const sapLoy = num(record.dealer_daily_report.loyalty_try);
  const sumNet = num(record.store_summary?.sales_total_try);
  const sumLoy = num(record.store_summary?.loyalty_points_total_try);
  if (Math.abs(sapNet - sumNet) > TOL || Math.abs(sapLoy - sumLoy) > TOL) {
    return { ok: false, reason: "3. Aşama uyumsuz: SAP Bayi Raporu ile Mağaza Özeti farklı" };
  }
  return { ok: true, reason: null };
}
