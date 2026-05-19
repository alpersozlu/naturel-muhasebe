import "server-only";
import ExcelJS, {
  type Worksheet,
  type Workbook,
  type Borders,
  type Cell,
} from "exceljs";

export const COLORS = {
  primary: "FF6366F1",       // indigo-500
  primaryLight: "FFEEF2FF",  // indigo-50
  text: "FF1F2937",          // slate-800
  textMuted: "FF6B7280",     // slate-500
  borderLight: "FFE5E7EB",   // slate-200
  altRow: "FFF9FAFB",        // slate-50
  emerald: "FF10B981",
  emeraldLight: "FFD1FAE5",
  rose: "FFEF4444",
  roseLight: "FFFEE2E2",
  amber: "FFF59E0B",
  amberLight: "FFFEF3C7",
};

export const TRY_FORMAT = '#,##0.00 "₺"';
export const INT_FORMAT = "#,##0";
export const PCT_FORMAT = '0.0"%"';
export const DATE_FORMAT = "dd.mm.yyyy";

export function newWorkbook(meta: {
  title: string;
  subject?: string;
}): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Naturel Ticaret Muhasebe";
  wb.company = "Naturel Ticaret";
  wb.title = meta.title;
  wb.subject = meta.subject ?? "Naturel Ticaret raporu";
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

const HAIRLINE: Partial<Borders> = {
  top: { style: "thin", color: { argb: COLORS.borderLight } },
  left: { style: "thin", color: { argb: COLORS.borderLight } },
  bottom: { style: "thin", color: { argb: COLORS.borderLight } },
  right: { style: "thin", color: { argb: COLORS.borderLight } },
};

/**
 * Branded title block at the top of a sheet. Reserves rows 1-4.
 * Title (large), subtitle (medium), filter line (small).
 */
export function writeHeader(
  ws: Worksheet,
  opts: {
    title: string;
    subtitle: string;
    filterSummary?: string;
    columnCount: number;
  }
): number {
  const colSpan = opts.columnCount;
  const colLetter = (n: number) =>
    String.fromCharCode(64 + Math.min(n, 26));
  const lastCol = colLetter(colSpan);

  // Row 1: brand name + logo placeholder
  ws.mergeCells(`A1:${lastCol}1`);
  const a1 = ws.getCell("A1");
  a1.value = "Naturel Ticaret Muhasebe";
  a1.font = {
    name: "Inter",
    size: 18,
    bold: true,
    color: { argb: COLORS.text },
  };
  a1.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 28;

  // Row 2: report title
  ws.mergeCells(`A2:${lastCol}2`);
  const a2 = ws.getCell("A2");
  a2.value = opts.title;
  a2.font = {
    name: "Inter",
    size: 14,
    color: { argb: COLORS.primary },
  };
  ws.getRow(2).height = 20;

  // Row 3: subtitle (date range / period)
  ws.mergeCells(`A3:${lastCol}3`);
  const a3 = ws.getCell("A3");
  a3.value = opts.subtitle;
  a3.font = { name: "Inter", size: 11, color: { argb: COLORS.textMuted } };
  ws.getRow(3).height = 18;

  // Row 4: filter summary (optional)
  if (opts.filterSummary) {
    ws.mergeCells(`A4:${lastCol}4`);
    const a4 = ws.getCell("A4");
    a4.value = opts.filterSummary;
    a4.font = {
      name: "Inter",
      size: 9,
      italic: true,
      color: { argb: COLORS.textMuted },
    };
    ws.getRow(4).height = 15;
  }
  return opts.filterSummary ? 5 : 4; // next free row
}

/**
 * Render a styled table starting at startRow. First row is the header.
 * `columns` defines header label, key in data, and optional format.
 *
 * Returns the next free row after the table.
 */
export function writeTable<T extends Record<string, unknown>>(
  ws: Worksheet,
  opts: {
    startRow: number;
    columns: Array<{
      header: string;
      key: keyof T & string;
      width?: number;
      format?: "money" | "int" | "pct" | "date" | "text";
      align?: "left" | "right" | "center";
    }>;
    data: T[];
    /** Optional last "Toplam" row with summed money/int columns */
    totals?: boolean;
  }
): number {
  let row = opts.startRow;

  // Header row
  opts.columns.forEach((col, i) => {
    const cell = ws.getRow(row).getCell(i + 1);
    cell.value = col.header;
    cell.font = {
      name: "Inter",
      size: 10,
      bold: true,
      color: { argb: COLORS.text },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.primaryLight },
    };
    cell.alignment = {
      horizontal: col.align ?? (col.format === "money" || col.format === "int" || col.format === "pct" ? "right" : "left"),
      vertical: "middle",
    };
    cell.border = HAIRLINE;
  });
  ws.getRow(row).height = 22;
  row += 1;

  // Body rows
  opts.data.forEach((item, rowIdx) => {
    const isAlt = rowIdx % 2 === 1;
    opts.columns.forEach((col, i) => {
      const cell = ws.getRow(row).getCell(i + 1);
      cell.value = item[col.key] as ExcelJS.CellValue;
      cell.font = { name: "Inter", size: 10, color: { argb: COLORS.text } };
      if (isAlt) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.altRow },
        };
      }
      cell.border = HAIRLINE;
      cell.alignment = {
        horizontal: col.align ?? (col.format === "money" || col.format === "int" || col.format === "pct" ? "right" : "left"),
        vertical: "middle",
      };
      applyFormat(cell, col.format);
    });
    row += 1;
  });

  // Totals row
  if (opts.totals && opts.data.length > 0) {
    opts.columns.forEach((col, i) => {
      const cell = ws.getRow(row).getCell(i + 1);
      if (i === 0) {
        cell.value = "TOPLAM";
        cell.font = { name: "Inter", size: 10, bold: true, color: { argb: COLORS.text } };
      } else if (col.format === "money" || col.format === "int") {
        const sum = opts.data.reduce(
          (s, item) => s + Number(item[col.key] ?? 0),
          0
        );
        cell.value = sum;
        cell.font = {
          name: "Inter",
          size: 10,
          bold: true,
          color: { argb: COLORS.text },
        };
        applyFormat(cell, col.format);
      } else {
        cell.value = "";
      }
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.primaryLight },
      };
      cell.border = {
        top: { style: "medium", color: { argb: COLORS.primary } },
        left: { style: "thin", color: { argb: COLORS.borderLight } },
        bottom: { style: "thin", color: { argb: COLORS.borderLight } },
        right: { style: "thin", color: { argb: COLORS.borderLight } },
      };
      cell.alignment = {
        horizontal:
          col.align ?? (col.format === "money" || col.format === "int" ? "right" : "left"),
        vertical: "middle",
      };
    });
    ws.getRow(row).height = 24;
    row += 1;
  }

  // Apply column widths
  opts.columns.forEach((col, i) => {
    if (col.width) {
      ws.getColumn(i + 1).width = col.width;
    }
  });

  return row + 1; // leave 1 blank line
}

function applyFormat(cell: Cell, format?: string): void {
  if (format === "money") {
    cell.numFmt = TRY_FORMAT;
  } else if (format === "int") {
    cell.numFmt = INT_FORMAT;
  } else if (format === "pct") {
    cell.numFmt = PCT_FORMAT;
  } else if (format === "date") {
    cell.numFmt = DATE_FORMAT;
  }
}

/**
 * KPI band — 4 cards side-by-side, each spanning 2 columns.
 * Useful at the top of a summary sheet.
 */
export function writeKpiRow(
  ws: Worksheet,
  startRow: number,
  cards: Array<{ label: string; value: number; format?: "money" | "int" }>
): number {
  // Label row
  cards.forEach((card, i) => {
    const col = i * 2 + 1;
    ws.mergeCells(startRow, col, startRow, col + 1);
    const cell = ws.getRow(startRow).getCell(col);
    cell.value = card.label.toUpperCase();
    cell.font = {
      name: "Inter",
      size: 9,
      bold: true,
      color: { argb: COLORS.textMuted },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.borderLight } },
      left: { style: "thin", color: { argb: COLORS.borderLight } },
      right: { style: "thin", color: { argb: COLORS.borderLight } },
    };
  });
  ws.getRow(startRow).height = 18;

  // Value row
  cards.forEach((card, i) => {
    const col = i * 2 + 1;
    ws.mergeCells(startRow + 1, col, startRow + 1, col + 1);
    const cell = ws.getRow(startRow + 1).getCell(col);
    cell.value = card.value;
    cell.font = {
      name: "Inter",
      size: 16,
      bold: true,
      color: { argb: COLORS.text },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.numFmt = card.format === "int" ? INT_FORMAT : TRY_FORMAT;
    cell.border = {
      left: { style: "thin", color: { argb: COLORS.borderLight } },
      right: { style: "thin", color: { argb: COLORS.borderLight } },
      bottom: { style: "thin", color: { argb: COLORS.borderLight } },
    };
  });
  ws.getRow(startRow + 1).height = 30;

  return startRow + 3; // 2 used + 1 blank
}

export async function workbookToBase64(wb: Workbook): Promise<string> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}
