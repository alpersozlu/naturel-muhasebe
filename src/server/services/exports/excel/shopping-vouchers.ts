import "server-only";
import type { ShoppingVouchersSummary } from "@/server/services/analytics/shopping-vouchers";
import {
  newWorkbook,
  writeHeader,
  writeTable,
  workbookToBase64,
  COLORS,
} from "./_workbook";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Alışveriş Çeki Takibi Excel — ay bazında, tarihli döküm.
 * Türkiye'ye (Mavi HQ) iade bildirimi için tek sayfa, satır satır.
 */
export async function buildShoppingVouchersExcel(opts: {
  summary: ShoppingVouchersSummary;
  brandName?: string;
  storeName?: string;
}): Promise<{ base64: string; filename: string }> {
  const { summary } = opts;
  const wb = newWorkbook({ title: `Alışveriş Çekleri — ${summary.period_label}` });
  const ws = wb.addWorksheet("Alışveriş Çekleri");

  const filterParts: string[] = [];
  if (opts.brandName) filterParts.push(`Marka: ${opts.brandName}`);
  if (opts.storeName) filterParts.push(`Mağaza: ${opts.storeName}`);

  let row = writeHeader(ws, {
    title: "Alışveriş Çeki Takibi (Türkiye İade Bildirimi)",
    subtitle: `${summary.period_label} · ${summary.entry_count} kayıt · Toplam ${summary.grand_total.toFixed(2)} ₺`,
    filterSummary: filterParts.length ? filterParts.join("  •  ") : undefined,
    columnCount: 4,
  });

  type Row = {
    date: string;
    brand: string;
    store: string;
    amount: number;
  };
  const rows: Row[] = summary.entries.map((e) => ({
    date: fmtDate(e.date),
    brand: e.brand_name,
    store: e.store_name,
    amount: e.amount,
  }));

  row = writeTable<Row>(ws, {
    startRow: row,
    columns: [
      { header: "Tarih", key: "date", width: 14 },
      { header: "Marka", key: "brand", width: 18 },
      { header: "Mağaza", key: "store", width: 24 },
      { header: "Alışveriş Çeki (₺)", key: "amount", width: 20, format: "money" },
    ],
    data: rows,
  });

  // Genel toplam satırı
  const gtCell = ws.getRow(row).getCell(1);
  gtCell.value = "GENEL TOPLAM";
  gtCell.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.text } };
  const gtVal = ws.getRow(row).getCell(4);
  gtVal.value = summary.grand_total;
  gtVal.numFmt = '#,##0.00 "₺"';
  gtVal.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.primary } };
  gtVal.alignment = { horizontal: "right" };

  const base64 = await workbookToBase64(wb);
  const safe = (s: string) => s.replace(/[^\w]+/g, "_");
  const filename = `Alisveris_Cekleri_${safe(summary.period_label)}.xlsx`;
  return { base64, filename };
}
