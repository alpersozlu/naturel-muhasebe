import "server-only";
import { newWorkbook, workbookToBase64, writeHeader, writeTable } from "./_workbook";

export type NebimSalesExcelRow = {
  tarih: Date;
  fis: string;
  magaza: string;
  urun: string;
  kod: string;
  renk_beden: string;
  satici: string;
  musteri: string;
  odeme: string;
  kart: string;
  adet: number;
  orijinal: number | null;
  indirim_pct: number | null;
  net: number | null;
  kampanya: string;
  iskonto_nedeni: string;
  yonetim_aciklamasi: string;
  fis_notu: string;
  iade: string;
};

const COLUMNS: Array<{
  header: string;
  key: keyof NebimSalesExcelRow & string;
  width?: number;
  format?: "money" | "int" | "pct" | "date" | "text";
}> = [
  { header: "Tarih", key: "tarih", width: 12, format: "date" },
  { header: "Fiş No", key: "fis", width: 16 },
  { header: "Mağaza", key: "magaza", width: 16 },
  { header: "Ürün", key: "urun", width: 30 },
  { header: "Kod", key: "kod", width: 16 },
  { header: "Renk / Beden", key: "renk_beden", width: 16 },
  { header: "Satıcı", key: "satici", width: 18 },
  { header: "Müşteri", key: "musteri", width: 20 },
  { header: "Ödeme", key: "odeme", width: 16 },
  { header: "Kart", key: "kart", width: 14 },
  { header: "Adet", key: "adet", width: 7, format: "int" },
  { header: "Orijinal", key: "orijinal", width: 13, format: "money" },
  { header: "İnd. %", key: "indirim_pct", width: 9, format: "pct" },
  { header: "Net", key: "net", width: 13, format: "money" },
  { header: "Kampanya", key: "kampanya", width: 28 },
  { header: "İskonto Nedeni", key: "iskonto_nedeni", width: 18 },
  { header: "Yönetim Açıklaması", key: "yonetim_aciklamasi", width: 28 },
  { header: "Fiş Notu", key: "fis_notu", width: 28 },
  { header: "İade", key: "iade", width: 7 },
];

export async function buildNebimSalesExcel(opts: {
  rows: NebimSalesExcelRow[];
  subtitle: string;
  filterSummary?: string;
  fileTag: string;
}): Promise<{ base64: string; filename: string }> {
  const wb = newWorkbook({ title: "Derimod Satışları" });
  const ws = wb.addWorksheet("Derimod Satışları", {
    views: [{ state: "frozen", ySplit: opts.filterSummary ? 5 : 4 }],
  });

  COLUMNS.forEach((c, i) => {
    if (c.width) ws.getColumn(i + 1).width = c.width;
  });

  const startRow = writeHeader(ws, {
    title: "Derimod Satışları (NEBIM)",
    subtitle: opts.subtitle,
    filterSummary: opts.filterSummary,
    columnCount: COLUMNS.length,
  });

  writeTable(ws, { startRow, columns: COLUMNS, data: opts.rows, totals: true });

  const base64 = await workbookToBase64(wb);
  return { base64, filename: `Derimod_Satislari_${opts.fileTag}.xlsx` };
}
