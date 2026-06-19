import "server-only";
import type { PrismaClient } from "@prisma/client";
import {
  masrafMatrix,
  MAVI_STORE_CODES,
  MAVI_STORE_NAMES,
  type MatrixCell,
} from "./dagitim";
import { MAVI_ROW_ORDER, type MaviRowDef } from "@/lib/masraf/mavi-rows";

/**
 * MAVI MASRAF RAPORU (Faz 4) — şekillendirme katmanı.
 *
 * `masrafMatrix` ham matrisini (kategori → ay → mağaza → {total,invoiced,cash,pos})
 * alır, sabit satır sırasına (`MAVI_ROW_ORDER`) oturtur ve ekran tablosu + Excel
 * export'un ihtiyaç duyduğu toplamları/kaynak bayraklarını ekler.
 *
 * Tek kaynak: hem `invoicedExpense.report` query'si hem Excel builder bunu kullanır.
 */

export const MAVI_MONTHS: readonly { num: number; label: string }[] = [
  { num: 1, label: "Ocak" },
  { num: 2, label: "Şubat" },
  { num: 3, label: "Mart" },
  { num: 4, label: "Nisan" },
  { num: 5, label: "Mayıs" },
  { num: 6, label: "Haziran" },
  { num: 7, label: "Temmuz" },
  { num: 8, label: "Ağustos" },
  { num: 9, label: "Eylül" },
  { num: 10, label: "Ekim" },
  { num: 11, label: "Kasım" },
  { num: 12, label: "Aralık" },
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type MaviSource = "invoiced" | "cash" | "pos";

export type MaviReportRow = MaviRowDef & {
  /** ay(1-12) → mağaza kodu → hücre (kaynak ayrımıyla). Boş aylar atlanır. */
  cells: Record<number, Record<string, MatrixCell>>;
  /** mağaza kodu → bu kategorinin yıl toplamı */
  storeTotals: Record<string, number>;
  /** bu kategorinin yıl geneli toplamı */
  rowTotal: number;
  /** hangi kaynaklar bu satıra katkı yaptı (rozet için) */
  sources: MaviSource[];
  /** veri var mı (auto satır boşsa false → "veri bekleniyor") */
  hasData: boolean;
};

export type MaviReport = {
  year: number;
  store_count: number;
  storeCodes: string[];
  storeNames: Record<string, string>;
  months: readonly { num: number; label: string }[];
  rows: MaviReportRow[];
  /** ay → mağaza → toplam (alt TOPLAM satırı) */
  columnTotals: Record<number, Record<string, number>>;
  /** mağaza kodu → yıl toplamı */
  storeTotals: Record<string, number>;
  /** ay → yıl-içi ay toplamı (tüm mağaza+kategori) */
  monthTotals: Record<number, number>;
  /** sistemin otomatik doldurduğu toplam (auto satırlar) */
  autoTotal: number;
  /** genel toplam (auto satırlar; manuel satırlar henüz 0) */
  grandTotal: number;
  /** herhangi bir auto satırda veri var mı */
  hasAnyData: boolean;
};

/**
 * Mavi masraf raporunu kur. Manuel satırlar (`auto: false`) boş döner —
 * UI/Excel bunları "manuel bekliyor" olarak işaretler.
 */
export async function buildMaviReport(
  prisma: PrismaClient,
  year: number
): Promise<MaviReport> {
  const m = await masrafMatrix(prisma, year);
  const codes = [...MAVI_STORE_CODES];

  const columnTotals: Record<number, Record<string, number>> = {};
  const storeTotals: Record<string, number> = Object.fromEntries(
    codes.map((c) => [c, 0])
  );
  const monthTotals: Record<number, number> = {};
  let grandTotal = 0;
  let autoTotal = 0;

  const rows: MaviReportRow[] = MAVI_ROW_ORDER.map((def) => {
    const byMonth = def.auto ? m.matrix[def.key] : undefined;

    const cells: Record<number, Record<string, MatrixCell>> = {};
    const rowStoreTotals: Record<string, number> = Object.fromEntries(
      codes.map((c) => [c, 0])
    );
    let rowTotal = 0;
    const srcSet = { invoiced: false, cash: false, pos: false };

    if (byMonth) {
      for (const { num: month } of MAVI_MONTHS) {
        const byStore = byMonth[month];
        if (!byStore) continue;
        for (const code of codes) {
          const cell = byStore[code];
          if (!cell || cell.total === 0) continue;
          (cells[month] ??= {})[code] = cell;
          rowStoreTotals[code] = round2((rowStoreTotals[code] ?? 0) + cell.total);
          rowTotal = round2(rowTotal + cell.total);
          if (cell.invoiced) srcSet.invoiced = true;
          if (cell.cash) srcSet.cash = true;
          if (cell.pos) srcSet.pos = true;

          // toplamlar
          const colByStore = (columnTotals[month] ??= {});
          colByStore[code] = round2((colByStore[code] ?? 0) + cell.total);
          storeTotals[code] = round2((storeTotals[code] ?? 0) + cell.total);
          monthTotals[month] = round2((monthTotals[month] ?? 0) + cell.total);
        }
      }
    }

    if (def.auto) {
      autoTotal = round2(autoTotal + rowTotal);
      grandTotal = round2(grandTotal + rowTotal);
    }

    const sources: MaviSource[] = [];
    if (srcSet.invoiced) sources.push("invoiced");
    if (srcSet.cash) sources.push("cash");
    if (srcSet.pos) sources.push("pos");

    return {
      ...def,
      cells,
      storeTotals: rowStoreTotals,
      rowTotal,
      sources,
      hasData: rowTotal > 0,
    };
  });

  return {
    year,
    store_count: m.store_count,
    storeCodes: codes,
    storeNames: MAVI_STORE_NAMES,
    months: MAVI_MONTHS,
    rows,
    columnTotals,
    storeTotals,
    monthTotals,
    autoTotal,
    grandTotal,
    hasAnyData: rows.some((r) => r.auto && r.hasData),
  };
}

export type MaviReportType = Awaited<ReturnType<typeof buildMaviReport>>;
