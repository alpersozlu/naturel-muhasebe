import "server-only";
import type { ExpenseSummary } from "@/server/services/analytics/expense";
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

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  marketing: "Pazarlama",
  other: "Diğer",
};

export async function buildExpenseExcel(opts: {
  summary: ExpenseSummary;
  year: number;
  month: number;
  brandName?: string;
  storeName?: string;
}): Promise<{ base64: string; filename: string }> {
  const periodLabel = `${MONTHS[opts.month - 1]} ${opts.year}`;
  const wb = newWorkbook({
    title: "Gider Analizi Raporu",
    subject: `Naturel Ticaret - ${periodLabel}`,
  });

  const filterParts = [
    opts.brandName ? `Marka: ${opts.brandName}` : "Tüm Markalar",
    opts.storeName ? `Mağaza: ${opts.storeName}` : "Tüm Mağazalar",
  ];

  // Sheet 1: ÖZET
  const sumSheet = wb.addWorksheet("Özet", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  for (let i = 1; i <= 8; i++) {
    sumSheet.getColumn(i).width = i % 2 === 0 ? 18 : 24;
  }
  let row = writeHeader(sumSheet, {
    title: "Gider Analizi",
    subtitle: periodLabel,
    filterSummary: filterParts.join("  ·  "),
    columnCount: 8,
  });
  row += 1;
  row = writeKpiRow(sumSheet, row, [
    { label: "Toplam Gider", value: opts.summary.total, format: "money" },
    { label: "Toplam Kayıt", value: opts.summary.count, format: "int" },
    {
      label: "En Çok Kategori",
      value: opts.summary.by_category[0]?.total ?? 0,
      format: "money",
    },
    {
      label: "En Çok Mağaza",
      value: opts.summary.by_store[0]?.total ?? 0,
      format: "money",
    },
  ]);

  // Highlights table
  void writeTable(sumSheet, {
    startRow: row,
    columns: [
      { header: "Öne Çıkan", key: "label", width: 28, align: "left" },
      { header: "İsim", key: "name", width: 28, align: "left" },
      { header: "Tutar", key: "amount", width: 20, format: "money" },
    ],
    data: [
      {
        label: "En çok harcanan kategori",
        name: opts.summary.by_category[0]
          ? CATEGORY_LABEL[opts.summary.by_category[0].category] ?? opts.summary.by_category[0].category
          : "—",
        amount: opts.summary.by_category[0]?.total ?? 0,
      },
      {
        label: "En çok harcayan mağaza",
        name: opts.summary.by_store[0]?.store_name ?? "—",
        amount: opts.summary.by_store[0]?.total ?? 0,
      },
      {
        label: "En çok harcayan çalışan",
        name: opts.summary.by_employee[0]?.employee_name ?? "—",
        amount: opts.summary.by_employee[0]?.total ?? 0,
      },
    ],
  });

  // Sheet 2: AYLIK TREND
  const trendSheet = wb.addWorksheet("Aylık Trend");
  let trow = writeHeader(trendSheet, {
    title: "Son 6 Ay Gider Trendi",
    subtitle: periodLabel,
    filterSummary: filterParts.join("  ·  "),
    columnCount: 2,
  });
  trow += 1;
  void writeTable(trendSheet, {
    startRow: trow,
    columns: [
      { header: "Ay", key: "month", width: 22, align: "left" },
      { header: "Toplam Gider", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.monthly_trend,
  });

  // Sheet 3: KATEGORİ DETAY
  const catSheet = wb.addWorksheet("Kategori Detayı", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  let crow = writeHeader(catSheet, {
    title: "Kategori Bazında Giderler",
    subtitle: periodLabel,
    columnCount: 3,
  });
  crow += 1;
  void writeTable(catSheet, {
    startRow: crow,
    columns: [
      { header: "Kategori", key: "category_label", width: 24, align: "left" },
      { header: "Kayıt Sayısı", key: "count", width: 16, format: "int" },
      { header: "Toplam Tutar", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.by_category.map((c) => ({
      ...c,
      category_label: CATEGORY_LABEL[c.category] ?? c.category,
    })),
    totals: true,
  });

  // Sheet 4: MAĞAZA DETAY
  const storeSheet = wb.addWorksheet("Mağaza Detayı");
  let srow = writeHeader(storeSheet, {
    title: "Mağaza Bazında Giderler",
    subtitle: periodLabel,
    columnCount: 2,
  });
  srow += 1;
  void writeTable(storeSheet, {
    startRow: srow,
    columns: [
      { header: "Mağaza", key: "store_name", width: 30, align: "left" },
      { header: "Toplam Gider", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.by_store,
    totals: true,
  });

  // Sheet 5: ÇALIŞAN DETAY
  const empSheet = wb.addWorksheet("Çalışan Detayı");
  let erow = writeHeader(empSheet, {
    title: "Çalışan Bazında Giderler",
    subtitle: periodLabel,
    columnCount: 2,
  });
  erow += 1;
  void writeTable(empSheet, {
    startRow: erow,
    columns: [
      { header: "Çalışan", key: "employee_name", width: 30, align: "left" },
      { header: "Toplam Gider", key: "total", width: 22, format: "money" },
    ],
    data: opts.summary.by_employee,
    totals: true,
  });

  const base64 = await workbookToBase64(wb);
  const filename = `Gider-Analizi-${opts.year}-${String(opts.month).padStart(2, "0")}.xlsx`;
  return { base64, filename };
}
