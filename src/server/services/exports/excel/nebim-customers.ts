import "server-only";
import type { NebimCustomerRow } from "@/server/trpc/routers/nebimSales";
import {
  newWorkbook,
  writeHeader,
  writeTable,
  workbookToBase64,
  COLORS,
} from "./_workbook";

const TIER_LABEL: Record<string, string> = {
  vip: "VIP",
  gold: "Altın",
  silver: "Gümüş",
  bronze: "Bronz",
};

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Müşteri Analizi Excel — dönem içi net harcamaya göre sıralı müşteri listesi
 * (sadakat rozeti + fiş/adet/ortalama sepet + ilk/son alışveriş).
 */
export async function buildNebimCustomersExcel(opts: {
  rows: NebimCustomerRow[];
  kpi: {
    customers: number;
    net_total: number;
    new_customers: number;
    repeat_pct: number;
    avg_spend: number;
  };
  date_from?: string;
  date_to?: string;
}): Promise<{ base64: string; filename: string }> {
  const period =
    opts.date_from || opts.date_to
      ? `${fmtDate(opts.date_from ?? "")} → ${fmtDate(opts.date_to ?? "")}`
      : "Tüm zaman";
  const wb = newWorkbook({ title: `Müşteri Analizi — ${period}` });
  const ws = wb.addWorksheet("Müşteriler");

  let row = writeHeader(ws, {
    title: "Derimod Müşteri Analizi (NEBIM)",
    subtitle:
      `${period} · ${opts.kpi.customers} müşteri · Ciro ${opts.kpi.net_total.toFixed(2)} ₺ · ` +
      `Yeni ${opts.kpi.new_customers} · Tekrar %${opts.kpi.repeat_pct.toFixed(1)}`,
    columnCount: 10,
  });

  type Row = {
    rank: number;
    name: string;
    code: string;
    tier: string;
    net: number;
    invoices: number;
    units: number;
    basket: number;
    first: string;
    last: string;
  };
  const rows: Row[] = opts.rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    code: r.code ?? "",
    tier: r.tier ? TIER_LABEL[r.tier] ?? r.tier : "",
    net: r.net,
    invoices: r.invoices,
    units: r.units,
    basket: r.avg_basket,
    first: fmtDate(r.first_date),
    last: fmtDate(r.last_date),
  }));

  row = writeTable<Row>(ws, {
    startRow: row,
    columns: [
      { header: "#", key: "rank", width: 6, format: "int" },
      { header: "Müşteri", key: "name", width: 30 },
      { header: "Kod", key: "code", width: 14 },
      { header: "Sadakat", key: "tier", width: 10 },
      { header: "Net (₺)", key: "net", width: 16, format: "money" },
      { header: "Fiş", key: "invoices", width: 8, format: "int" },
      { header: "Adet", key: "units", width: 8, format: "int" },
      { header: "Ort. Sepet (₺)", key: "basket", width: 16, format: "money" },
      { header: "İlk Alışveriş", key: "first", width: 14 },
      { header: "Son Alışveriş", key: "last", width: 14 },
    ],
    data: rows,
  });

  // Genel toplam satırı
  const gtCell = ws.getRow(row).getCell(2);
  gtCell.value = "TOPLAM (listelenen)";
  gtCell.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.text } };
  const gtVal = ws.getRow(row).getCell(5);
  gtVal.value = rows.reduce((s, r) => s + r.net, 0);
  gtVal.numFmt = '#,##0.00 "₺"';
  gtVal.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.primary } };
  gtVal.alignment = { horizontal: "right" };

  const base64 = await workbookToBase64(wb);
  const safe = (s: string) => s.replace(/[^\w]+/g, "_");
  const filename = `Musteri_Analizi_${safe(period)}.xlsx`;
  return { base64, filename };
}
