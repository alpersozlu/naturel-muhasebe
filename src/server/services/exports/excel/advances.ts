import "server-only";
import type { AdvancesSummary } from "@/server/services/analytics/advances";
import {
  newWorkbook,
  writeHeader,
  writeTable,
  workbookToBase64,
  COLORS,
} from "./_workbook";

const STAFF_ROLE_LABEL: Record<string, string> = {
  manager: "Müdür",
  assistant_manager: "Müdür Yardımcısı",
  sales_staff: "Satış Elemanı",
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Avans Takip Excel — ay bazında, kişi kişi tarihli döküm + kişi toplamı.
 * Maaştan kesinti için tek sayfa, satır satır.
 */
export async function buildAdvancesExcel(opts: {
  summary: AdvancesSummary;
  brandName?: string;
  storeName?: string;
}): Promise<{ base64: string; filename: string }> {
  const { summary } = opts;
  const wb = newWorkbook({ title: `Avans Takip — ${summary.period_label}` });
  const ws = wb.addWorksheet("Avanslar");

  const filterParts: string[] = [];
  if (opts.brandName) filterParts.push(`Marka: ${opts.brandName}`);
  if (opts.storeName) filterParts.push(`Mağaza: ${opts.storeName}`);

  let row = writeHeader(ws, {
    title: "Avans Takip Raporu",
    subtitle: `${summary.period_label} · ${summary.people.length} kişi · ${summary.entry_count} kayıt · Toplam ${summary.grand_total.toFixed(2)} ₺`,
    filterSummary: filterParts.length ? filterParts.join("  •  ") : undefined,
    columnCount: 5,
  });

  // Tek tablo: her satır bir avans, kişi grupları arasında ara-toplam satırı
  type Row = {
    person: string;
    role: string;
    date: string;
    store: string;
    amount: number | string;
  };
  const rows: Row[] = [];
  for (const p of summary.people) {
    for (const e of p.entries) {
      rows.push({
        person: p.staff_name,
        role: p.staff_role ? STAFF_ROLE_LABEL[p.staff_role] ?? p.staff_role : "",
        date: fmtDate(e.date),
        store: e.store_name,
        amount: e.amount,
      });
    }
    // Kişi ara toplamı
    rows.push({
      person: `${p.staff_name} — TOPLAM`,
      role: "",
      date: "",
      store: "",
      amount: p.total,
    });
  }

  row = writeTable<Row>(ws, {
    startRow: row,
    columns: [
      { header: "Personel", key: "person", width: 28 },
      { header: "Rol", key: "role", width: 18 },
      { header: "Tarih", key: "date", width: 14 },
      { header: "Mağaza", key: "store", width: 18 },
      { header: "Tutar (₺)", key: "amount", width: 16, format: "money" },
    ],
    data: rows,
  });

  // Genel toplam satırı
  const gtCell = ws.getRow(row).getCell(1);
  gtCell.value = "GENEL TOPLAM";
  gtCell.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.text } };
  const gtVal = ws.getRow(row).getCell(5);
  gtVal.value = summary.grand_total;
  gtVal.numFmt = '#,##0.00 "₺"';
  gtVal.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.rose } };
  gtVal.alignment = { horizontal: "right" };

  const base64 = await workbookToBase64(wb);
  const safe = (s: string) => s.replace(/[^\w]+/g, "_");
  const filename = `Avans_${safe(summary.period_label)}.xlsx`;
  return { base64, filename };
}
