import "server-only";
import type { Worksheet } from "exceljs";
import { newWorkbook, workbookToBase64, COLORS, TRY_FORMAT } from "./_workbook";
import type { MaviReport } from "@/server/services/masraf/mavi-report";

/**
 * "Mavi Masraflar" Excel — sahibinin "MAVI MASRAFLAR 2026.xlsx" düzeni (19.10.2026).
 *
 * Sayfa 1 "<yıl>": satır 1 ay adı (her mağaza sütununda tekrar), satır 2 mağaza
 *   kodu (9400/9401/9402/9403), A sütunu kategori. Grup başlıkları (KİRA, PERSONEL,
 *   DİĞER GİDERLER, OFİS) alt satırlarının SUM formülüdür; sahibinin dosyasıyla
 *   birebir aynı okunur. Sonda YIL TOPLAM sütunu ve GENEL TOPLAM satırı.
 * Sayfa 2 "Kaynak & Özet": her satırın yıl toplamı + kaynak kırılımı
 *   (şirket faturası ÷7 / kasa / POS / defolu / bordro / elle).
 */

const TITLE_FONT = { name: "Inter", size: 16, bold: true, color: { argb: COLORS.text } };
const SUB_FONT = { name: "Inter", size: 10, color: { argb: COLORS.textMuted } };
const SOURCE_LABEL: Record<string, string> = { invoiced: "Şirket faturası (÷7)", cash: "Kasa", pos: "POS %5", defolu: "Defolu", payroll: "Bordro", manual: "Elle" };

function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function blankIfZero(n: number): number | null {
  return n === 0 ? null : Math.round(n * 100) / 100;
}

function moneyCell(ws: Worksheet, row: number, col: number, value: number | null | { formula: string }): void {
  const cell = ws.getRow(row).getCell(col);
  if (value !== null) {
    cell.value = value;
    cell.numFmt = TRY_FORMAT;
  }
  cell.font = { name: "Inter", size: 9, color: { argb: COLORS.text } };
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.border = {
    bottom: { style: "thin", color: { argb: COLORS.borderLight } },
    right: { style: "thin", color: { argb: COLORS.borderLight } },
  };
}

export async function buildMaviMasraflarExcel(opts: { report: MaviReport }): Promise<{ base64: string; filename: string }> {
  const { report } = opts;
  const codes = report.storeCodes;
  const nStores = codes.length;
  const wb = newWorkbook({ title: `${report.title} ${report.year}` });

  // ── Sayfa 1: sahibinin düzeni ─────────────────────────────────────────
  const ws = wb.addWorksheet(String(report.year), { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  const firstDataCol = 2; // A = kategori
  const totalCol = firstDataCol + report.months.length * nStores; // YIL TOPLAM

  // Satır 1: ay adı (her mağaza sütununda), Satır 2: mağaza kodu
  report.months.forEach((mo, i) => {
    codes.forEach((code, j) => {
      const col = firstDataCol + i * nStores + j;
      const c1 = ws.getCell(1, col);
      c1.value = mo.label.toLocaleUpperCase("tr");
      c1.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.primary } };
      c1.alignment = { horizontal: "center", vertical: "middle" };
      c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
      c1.border = { left: j === 0 ? { style: "thin", color: { argb: COLORS.borderLight } } : undefined };
      const c2 = ws.getCell(2, col);
      c2.value = code;
      c2.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.textMuted } };
      c2.alignment = { horizontal: "center", vertical: "middle" };
      c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.altRow } };
      c2.border = { bottom: { style: "thin", color: { argb: COLORS.borderLight } }, right: { style: "thin", color: { argb: COLORS.borderLight } } };
      ws.getColumn(col).width = 13;
    });
  });
  const yt = ws.getCell(1, totalCol);
  yt.value = "YIL TOPLAM";
  yt.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
  yt.alignment = { horizontal: "center", vertical: "middle" };
  yt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  ws.mergeCells(1, totalCol, 2, totalCol);
  ws.getColumn(totalCol).width = 15;
  const a1 = ws.getCell(1, 1);
  a1.value = report.title;
  a1.font = { name: "Inter", size: 11, bold: true, color: { argb: COLORS.text } };
  ws.getCell(2, 1).value = `${report.year} · ${report.storeCodes.map((c) => `${c} ${report.storeNames[c]}`).join(" · ")}`;
  ws.getCell(2, 1).font = SUB_FONT;
  ws.getColumn(1).width = 34;

  // ── Gövde: grup başlığı (SUM formülü) + alt satırlar ─────────────────
  let row = 3;
  const groupRows: number[] = [];
  for (const g of report.groups) {
    const rows = report.rows.filter((r) => r.group === g.key);
    const headRow = row;
    const first = row + 1;
    const last = row + rows.length;
    groupRows.push(headRow);
    const hc = ws.getRow(headRow).getCell(1);
    hc.value = g.label;
    hc.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
    hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    hc.alignment = { horizontal: "left", vertical: "middle" };
    for (let col = firstDataCol; col <= totalCol; col++) {
      const L = colLetter(col);
      moneyCell(ws, headRow, col, { formula: `SUM(${L}${first}:${L}${last})` });
      const c = ws.getRow(headRow).getCell(col);
      c.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    }
    row += 1;
    for (const r of rows) {
      const cat = ws.getRow(row).getCell(1);
      cat.value = `  ${r.label}`;
      cat.font = { name: "Inter", size: 9, color: { argb: r.auto ? COLORS.text : COLORS.textMuted }, italic: !r.auto && !r.hasData };
      cat.alignment = { horizontal: "left", vertical: "middle" };
      cat.border = { bottom: { style: "thin", color: { argb: COLORS.borderLight } }, right: { style: "thin", color: { argb: COLORS.borderLight } } };
      if (!r.auto && !r.hasData) cat.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.amberLight } };
      report.months.forEach((mo, i) => {
        codes.forEach((code, j) => {
          const col = firstDataCol + i * nStores + j;
          moneyCell(ws, row, col, blankIfZero(r.cells[mo.num]?.[code]?.total ?? 0));
        });
      });
      const L = colLetter(firstDataCol);
      const R = colLetter(totalCol - 1);
      moneyCell(ws, row, totalCol, { formula: `SUM(${L}${row}:${R}${row})` });
      ws.getRow(row).getCell(totalCol).font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
      row += 1;
    }
    row += 1; // gruplar arası boşluk (sahibinin dosyasındaki gibi)
  }

  // ── GENEL TOPLAM = grup başlıklarının toplamı ───────────────────────────
  const totRow = row;
  const tc = ws.getRow(totRow).getCell(1);
  tc.value = "GENEL TOPLAM";
  tc.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
  tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  tc.border = { top: { style: "medium", color: { argb: COLORS.primary } } };
  for (let col = firstDataCol; col <= totalCol; col++) {
    const L = colLetter(col);
    moneyCell(ws, totRow, col, { formula: groupRows.map((gr) => `${L}${gr}`).join("+") });
    const c = ws.getRow(totRow).getCell(col);
    c.font = { name: "Inter", size: 9, bold: true, color: { argb: col === totalCol ? COLORS.primary : COLORS.text } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    c.border = { top: { style: "medium", color: { argb: COLORS.primary } }, right: { style: "thin", color: { argb: COLORS.borderLight } } };
  }
  ws.getRow(totRow).height = 22;

  // ── Sayfa 2: kaynak & özet ──────────────────────────────────────────────
  buildSummarySheet(wb.addWorksheet("Kaynak & Özet"), report);

  const base64 = await workbookToBase64(wb);
  return { base64, filename: `${report.fileTag}_${report.year}.xlsx` };
}

/** Sayfa 2 — her satırın yıl toplamı + kaynak kırılımı + durum. */
function buildSummarySheet(ws: Worksheet, report: MaviReport): void {
  const t = ws.getCell(1, 1);
  t.value = `Kaynak & Özet — ${report.title} ${report.year}`;
  t.font = TITLE_FONT;
  ws.mergeCells(1, 1, 1, 8);
  ws.getRow(1).height = 24;
  const sub = ws.getCell(2, 1);
  sub.value = `Şirket faturaları ÷${report.store_count} mağazaya eşit dağıtılır · Market ½ temizlik + ½ yemek · POS = Visa %5 · Bordro: Maaşlar modülü`;
  sub.font = SUB_FONT;

  const sources = ["invoiced", "cash", "pos", "defolu", "payroll", "manual"] as const;
  const headers = ["Grup", "Kategori", "Yıl Toplam (₺)", ...sources.map((s) => SOURCE_LABEL[s]), "Durum"];
  const headRow = 4;
  headers.forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    c.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    c.alignment = { horizontal: i <= 1 || i === headers.length - 1 ? "left" : "right", vertical: "middle" };
  });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 34;
  for (let i = 3; i <= headers.length - 1; i++) ws.getColumn(i).width = 17;
  ws.getColumn(headers.length).width = 26;

  let row = headRow + 1;
  for (const r of report.rows) {
    const acc: Record<string, number> = {};
    for (const byStore of Object.values(r.cells)) for (const cell of Object.values(byStore)) for (const s of sources) acc[s] = (acc[s] ?? 0) + cell[s];
    const money = (col: number, val: number) => {
      const c = ws.getCell(row, col);
      if (val !== 0) {
        c.value = Math.round(val * 100) / 100;
        c.numFmt = TRY_FORMAT;
      }
      c.font = { name: "Inter", size: 10, color: { argb: COLORS.text } };
      c.alignment = { horizontal: "right", vertical: "middle" };
    };
    ws.getCell(row, 1).value = report.groups.find((g) => g.key === r.group)?.label ?? r.group;
    ws.getCell(row, 1).font = { name: "Inter", size: 9, color: { argb: COLORS.textMuted } };
    ws.getCell(row, 2).value = r.label;
    ws.getCell(row, 2).font = { name: "Inter", size: 10, color: { argb: COLORS.text } };
    money(3, r.rowTotal);
    sources.forEach((s, i) => money(4 + i, acc[s] ?? 0));
    const status = ws.getCell(row, headers.length);
    status.value = r.hasData ? (r.auto ? "Otomatik" : "Elle girildi") : r.auto ? "Veri bekleniyor" : "Elle girilir";
    status.font = { name: "Inter", size: 9, color: { argb: r.hasData ? COLORS.emerald : r.auto ? COLORS.textMuted : COLORS.amber } };
    row += 1;
  }
  const gt = ws.getCell(row, 2);
  gt.value = "GENEL TOPLAM";
  gt.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
  gt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  const gtv = ws.getCell(row, 3);
  gtv.value = report.grandTotal;
  gtv.numFmt = TRY_FORMAT;
  gtv.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.primary } };
  gtv.alignment = { horizontal: "right", vertical: "middle" };
  gtv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
}
