import "server-only";
import type { RevenueSummary } from "@/server/services/analytics/revenue";
import {
  newWorkbook,
  writeHeader,
  writeKpiRow,
  writeTable,
  workbookToBase64,
} from "./_workbook";

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

export async function buildRevenueExcel(opts: {
  summary: RevenueSummary;
  year: number;
  month: number;
  brandName?: string;
  storeName?: string;
}): Promise<{ base64: string; filename: string }> {
  const periodLabel = `${MONTHS[opts.month - 1]} ${opts.year}`;
  const wb = newWorkbook({
    title: "Gelir Analizi Raporu",
    subject: `Naturel Ticaret - ${periodLabel}`,
  });

  const filterParts = [
    opts.brandName ? `Marka: ${opts.brandName}` : "Tüm Markalar",
    opts.storeName ? `Mağaza: ${opts.storeName}` : "Tüm Mağazalar",
  ];

  // ─────────────────────────────────────────
  // Sheet 1: ÖZET
  // ─────────────────────────────────────────
  const sumSheet = wb.addWorksheet("Özet", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  sumSheet.getColumn("A").width = 24;
  sumSheet.getColumn("B").width = 16;
  sumSheet.getColumn("C").width = 24;
  sumSheet.getColumn("D").width = 16;
  sumSheet.getColumn("E").width = 24;
  sumSheet.getColumn("F").width = 16;
  sumSheet.getColumn("G").width = 24;
  sumSheet.getColumn("H").width = 16;

  let row = writeHeader(sumSheet, {
    title: "Gelir Analizi",
    subtitle: periodLabel,
    filterSummary: filterParts.join("  ·  "),
    columnCount: 8,
  });
  row += 1;

  row = writeKpiRow(sumSheet, row, [
    { label: "Toplam Gelir", value: opts.summary.total, format: "money" },
    { label: "Nakit Gelir", value: opts.summary.cash, format: "money" },
    { label: "POS Gelir", value: opts.summary.pos, format: "money" },
    { label: "Günlük Ortalama", value: opts.summary.daily_avg, format: "money" },
  ]);

  // Quick stats table
  const cashShare = opts.summary.total > 0 ? (opts.summary.cash / opts.summary.total) * 100 : 0;
  const posShare = opts.summary.total > 0 ? (opts.summary.pos / opts.summary.total) * 100 : 0;
  const loyaltyShare = opts.summary.total > 0 ? (opts.summary.loyalty / opts.summary.total) * 100 : 0;

  void writeTable(sumSheet, {
    startRow: row,
    columns: [
      { header: "Gösterge", key: "label", width: 32, align: "left" },
      { header: "Değer", key: "value", width: 20, format: "money" },
      { header: "Pay", key: "share", width: 12, format: "pct" },
    ],
    data: [
      { label: "Toplam Gelir", value: opts.summary.total, share: 100 },
      { label: "Nakit Gelir", value: opts.summary.cash, share: cashShare },
      { label: "POS Gelir", value: opts.summary.pos, share: posShare },
      { label: "Kartuş Puan", value: opts.summary.loyalty, share: loyaltyShare },
      { label: "Aktif Gün Sayısı", value: opts.summary.active_days, share: 0 },
    ],
  });

  // ─────────────────────────────────────────
  // Sheet 2: GÜNLÜK DETAY
  // ─────────────────────────────────────────
  const dailySheet = wb.addWorksheet("Günlük Detay", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  let drow = writeHeader(dailySheet, {
    title: "Günlük Gelir Detayı",
    subtitle: periodLabel,
    filterSummary: filterParts.join("  ·  "),
    columnCount: 4,
  });
  drow += 1;

  void writeTable(dailySheet, {
    startRow: drow,
    columns: [
      { header: "Gün", key: "day", width: 8, align: "center", format: "int" },
      { header: "Nakit", key: "cash", width: 18, format: "money" },
      { header: "POS", key: "pos", width: 18, format: "money" },
      { header: "Toplam", key: "total", width: 20, format: "money" },
    ],
    data: opts.summary.daily_series.filter((d) => d.total > 0),
    totals: true,
  });

  // ─────────────────────────────────────────
  // Sheet 3: MAĞAZA BAZINDA
  // ─────────────────────────────────────────
  const storeSheet = wb.addWorksheet("Mağaza Bazında", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  let srow = writeHeader(storeSheet, {
    title: "Mağaza Bazında Gelir",
    subtitle: periodLabel,
    columnCount: 2,
  });
  srow += 1;
  void writeTable(storeSheet, {
    startRow: srow,
    columns: [
      { header: "Mağaza", key: "store_name", width: 28, align: "left" },
      { header: "Gelir", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.by_store,
    totals: true,
  });

  // ─────────────────────────────────────────
  // Sheet 4: BANKA BAZINDA POS
  // ─────────────────────────────────────────
  const bankSheet = wb.addWorksheet("Banka Bazında POS", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  let brow = writeHeader(bankSheet, {
    title: "Banka Bazında POS Gelirleri",
    subtitle: periodLabel,
    columnCount: 2,
  });
  brow += 1;
  void writeTable(bankSheet, {
    startRow: brow,
    columns: [
      { header: "Banka", key: "bank_name", width: 30, align: "left" },
      { header: "Tutar", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.by_bank,
    totals: true,
  });

  const base64 = await workbookToBase64(wb);
  const filename = `Gelir-Analizi-${opts.year}-${String(opts.month).padStart(2, "0")}.xlsx`;
  return { base64, filename };
}
