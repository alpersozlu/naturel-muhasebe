import "server-only";
import type { Worksheet } from "exceljs";
import { newWorkbook, workbookToBase64, COLORS, TRY_FORMAT } from "./_workbook";
import type { MaviReport } from "@/server/services/masraf/mavi-report";

/**
 * "Mavi Masraflar" Excel (Faz 4) — Dosya 3 formatı.
 *
 * Sayfa 1 "Mavi Masraflar": satır = kategori, sütun = ay × 4 mağaza
 *   (her ay altında 9400/9401/9402/9403 tekrarı) + YIL TOPLAM kolonu, alt TOPLAM satırı.
 *   Manuel kategoriler boş gelir (kullanıcı doldurur) ve hafif sarı tonla işaretlenir.
 * Sayfa 2 "Kaynak & Özet": her kategorinin yıl toplamı + faturalı/kasa/POS ayrımı + durum.
 *
 * Kaynak: docs/MASRAF-MUHASEBE-PLANI.md (Faz 4)
 */

const TITLE_FONT = { name: "Inter", size: 16, bold: true, color: { argb: COLORS.text } };
const SUB_FONT = { name: "Inter", size: 10, color: { argb: COLORS.textMuted } };

function blankIfZero(n: number): number | null {
  return n === 0 ? null : Math.round(n * 100) / 100;
}

function moneyCell(ws: Worksheet, row: number, col: number, value: number | null): void {
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

export async function buildMaviMasraflarExcel(opts: {
  report: MaviReport;
}): Promise<{ base64: string; filename: string }> {
  const { report } = opts;
  const codes = report.storeCodes;
  const nStores = codes.length;
  const wb = newWorkbook({ title: `Mavi Masraflar ${report.year}` });

  // ── Sayfa 1: matris ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Mavi Masraflar", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 5 }],
  });

  const firstDataCol = 2; // A = kategori
  const totalCol = firstDataCol + report.months.length * nStores; // YIL TOPLAM kolonu
  const lastCol = totalCol;

  // Satır 1: başlık
  ws.mergeCells(1, 1, 1, Math.min(lastCol, 8));
  const t = ws.getCell(1, 1);
  t.value = `Mavi Masraflar — ${report.year}`;
  t.font = TITLE_FONT;
  ws.getRow(1).height = 26;

  // Satır 2: altbaşlık + kaynak notu
  ws.mergeCells(2, 1, 2, Math.min(lastCol, 12));
  const s = ws.getCell(2, 1);
  s.value = `Genel toplam ${report.grandTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺  ·  kaynak: faturalı (÷${report.store_count}) + kasa + POS %5  ·  manuel kategoriler boştur, elle doldurulur`;
  s.font = SUB_FONT;
  ws.getRow(2).height = 16;

  // Satır 4-5: başlık (ay × mağaza)
  const headRow1 = 4;
  const headRow2 = 5;

  // A sütunu "KATEGORİ" (4-5 birleşik)
  ws.mergeCells(headRow1, 1, headRow2, 1);
  const catHead = ws.getCell(headRow1, 1);
  catHead.value = "KATEGORİ";
  catHead.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
  catHead.alignment = { horizontal: "left", vertical: "middle" };
  catHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };

  // Her ay: 4 mağaza kolonu
  report.months.forEach((mo, i) => {
    const start = firstDataCol + i * nStores;
    const end = start + nStores - 1;
    ws.mergeCells(headRow1, start, headRow1, end);
    const mc = ws.getCell(headRow1, start);
    mc.value = mo.label;
    mc.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.primary } };
    mc.alignment = { horizontal: "center", vertical: "middle" };
    mc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    mc.border = { left: { style: "thin", color: { argb: COLORS.borderLight } } };

    codes.forEach((code, j) => {
      const col = start + j;
      const hc = ws.getCell(headRow2, col);
      hc.value = `${code} ${report.storeNames[code] ?? ""}`.trim();
      hc.font = { name: "Inter", size: 8, bold: true, color: { argb: COLORS.textMuted } };
      hc.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.altRow } };
      hc.border = {
        bottom: { style: "thin", color: { argb: COLORS.borderLight } },
        right: { style: "thin", color: { argb: COLORS.borderLight } },
        left: j === 0 ? { style: "thin", color: { argb: COLORS.borderLight } } : undefined,
      };
      ws.getColumn(col).width = 13;
    });
  });

  // YIL TOPLAM kolonu (4-5 birleşik)
  ws.mergeCells(headRow1, totalCol, headRow2, totalCol);
  const ytHead = ws.getCell(headRow1, totalCol);
  ytHead.value = "YIL TOPLAM";
  ytHead.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
  ytHead.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  ytHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  ws.getColumn(totalCol).width = 15;
  ws.getColumn(1).width = 26;
  ws.getRow(headRow1).height = 20;
  ws.getRow(headRow2).height = 26;

  // ── Gövde: kategori satırları ──────────────────────────────────────────
  let row = headRow2 + 1;
  for (const r of report.rows) {
    const cat = ws.getRow(row).getCell(1);
    cat.value = r.auto ? r.label : `${r.label}  (manuel)`;
    cat.font = {
      name: "Inter",
      size: 10,
      bold: r.auto,
      color: { argb: r.auto ? COLORS.text : COLORS.textMuted },
      italic: !r.auto,
    };
    cat.alignment = { horizontal: "left", vertical: "middle" };
    cat.border = {
      bottom: { style: "thin", color: { argb: COLORS.borderLight } },
      right: { style: "thin", color: { argb: COLORS.borderLight } },
    };
    if (!r.auto) {
      cat.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.amberLight } };
    }

    // ay × mağaza hücreleri
    report.months.forEach((mo, i) => {
      const start = firstDataCol + i * nStores;
      codes.forEach((code, j) => {
        const col = start + j;
        const val = r.auto ? r.cells[mo.num]?.[code]?.total ?? 0 : 0;
        moneyCell(ws, row, col, r.auto ? blankIfZero(val) : null);
        if (!r.auto) {
          ws.getRow(row).getCell(col).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.amberLight },
          };
        }
      });
    });

    // YIL TOPLAM
    moneyCell(ws, row, totalCol, r.auto ? blankIfZero(r.rowTotal) : null);
    const ytc = ws.getRow(row).getCell(totalCol);
    ytc.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
    if (!r.auto) {
      ytc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.amberLight } };
    }
    row += 1;
  }

  // ── Alt TOPLAM satırı (sadece otomatik veriler) ────────────────────────
  const totRow = row;
  const tc = ws.getRow(totRow).getCell(1);
  tc.value = "TOPLAM (otomatik)";
  tc.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
  tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  tc.alignment = { horizontal: "left", vertical: "middle" };
  tc.border = { top: { style: "medium", color: { argb: COLORS.primary } } };

  report.months.forEach((mo, i) => {
    const start = firstDataCol + i * nStores;
    codes.forEach((code, j) => {
      const col = start + j;
      const val = report.columnTotals[mo.num]?.[code] ?? 0;
      moneyCell(ws, totRow, col, blankIfZero(val));
      const cell = ws.getRow(totRow).getCell(col);
      cell.font = { name: "Inter", size: 9, bold: true, color: { argb: COLORS.text } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
      cell.border = {
        top: { style: "medium", color: { argb: COLORS.primary } },
        right: { style: "thin", color: { argb: COLORS.borderLight } },
      };
    });
  });
  moneyCell(ws, totRow, totalCol, blankIfZero(report.autoTotal));
  const gtc = ws.getRow(totRow).getCell(totalCol);
  gtc.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.primary } };
  gtc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  gtc.border = { top: { style: "medium", color: { argb: COLORS.primary } } };
  ws.getRow(totRow).height = 22;

  // ── Sayfa 2: kaynak & özet ──────────────────────────────────────────────
  buildSummarySheet(wb.addWorksheet("Kaynak & Özet"), report);

  const base64 = await workbookToBase64(wb);
  return { base64, filename: `Mavi_Masraflar_${report.year}.xlsx` };
}

/** Sayfa 2 — her kategorinin yıl toplamı + faturalı/kasa/POS ayrımı + durum. */
function buildSummarySheet(ws: Worksheet, report: MaviReport): void {
  const t = ws.getCell(1, 1);
  t.value = `Kaynak & Özet — ${report.year}`;
  t.font = TITLE_FONT;
  ws.mergeCells(1, 1, 1, 6);
  ws.getRow(1).height = 24;

  const headers = ["Kategori", "Yıl Toplam (₺)", "Faturalı", "Kasa", "POS", "Defolu", "Durum"];
  const statusCol = headers.length; // "Durum" sütunu (1 tabanlı)
  const headRow = 3;
  headers.forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    c.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
    c.alignment = {
      horizontal: i === 0 || i === statusCol - 1 ? "left" : "right",
      vertical: "middle",
    };
  });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 14;
  ws.getColumn(7).width = 24;
  ws.getRow(headRow).height = 20;

  let row = headRow + 1;
  for (const r of report.rows) {
    // kaynak alt toplamları
    let inv = 0;
    let cash = 0;
    let pos = 0;
    let defolu = 0;
    for (const byStore of Object.values(r.cells)) {
      for (const cell of Object.values(byStore)) {
        inv += cell.invoiced;
        cash += cell.cash;
        pos += cell.pos;
        defolu += cell.defolu;
      }
    }
    const money = (col: number, val: number) => {
      const c = ws.getCell(row, col);
      if (val !== 0) {
        c.value = Math.round(val * 100) / 100;
        c.numFmt = TRY_FORMAT;
      }
      c.font = { name: "Inter", size: 10, color: { argb: COLORS.text } };
      c.alignment = { horizontal: "right", vertical: "middle" };
    };

    const nameCell = ws.getCell(row, 1);
    nameCell.value = r.label;
    nameCell.font = { name: "Inter", size: 10, color: { argb: COLORS.text } };
    money(2, r.rowTotal);
    money(3, inv);
    money(4, cash);
    money(5, pos);
    money(6, defolu);

    const status = ws.getCell(row, statusCol);
    status.value = r.auto ? (r.hasData ? "Otomatik" : "Otomatik — veri bekleniyor") : "Manuel bekliyor";
    status.font = {
      name: "Inter",
      size: 9,
      color: { argb: r.auto ? (r.hasData ? COLORS.emerald : COLORS.textMuted) : COLORS.amber },
    };
    status.alignment = { horizontal: "left", vertical: "middle" };
    row += 1;
  }

  // genel toplam
  const gt = ws.getCell(row, 1);
  gt.value = "GENEL TOPLAM (otomatik)";
  gt.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
  gt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
  const gtv = ws.getCell(row, 2);
  gtv.value = report.autoTotal;
  gtv.numFmt = TRY_FORMAT;
  gtv.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.primary } };
  gtv.alignment = { horizontal: "right", vertical: "middle" };
  gtv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primaryLight } };
}
