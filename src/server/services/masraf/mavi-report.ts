import "server-only";
import type { PrismaClient } from "@prisma/client";
import { masrafMatrix, MASRAF_SOURCES, type MasrafSource, type MatrixCell } from "./dagitim";
import { getMasrafBrand, MASRAF_GROUPS, type MasrafGroupKey, type MasrafRow } from "@/lib/masraf/brands";

/**
 * MASRAF RAPORU — şekillendirme katmanı.
 *
 * `masrafMatrix` ham matrisini alır, markanın sabit satır sırasına (sahibinin
 * Excel'i: KİRA / PERSONEL / DİĞER GİDERLER / OFİS) oturtur ve ekran tablosu +
 * Excel export'un ihtiyaç duyduğu toplamları/kaynak bayraklarını ekler.
 */

export const MAVI_MONTHS: readonly { num: number; label: string }[] = [
  { num: 1, label: "Ocak" }, { num: 2, label: "Şubat" }, { num: 3, label: "Mart" }, { num: 4, label: "Nisan" },
  { num: 5, label: "Mayıs" }, { num: 6, label: "Haziran" }, { num: 7, label: "Temmuz" }, { num: 8, label: "Ağustos" },
  { num: 9, label: "Eylül" }, { num: 10, label: "Ekim" }, { num: 11, label: "Kasım" }, { num: 12, label: "Aralık" },
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type MaviSource = MasrafSource;

export type MaviReportRow = MasrafRow & {
  /** ay(1-12) → mağaza kodu → hücre (kaynak ayrımıyla). Boş aylar atlanır. */
  cells: Record<number, Record<string, MatrixCell>>;
  /** mağaza kodu → bu satırın yıl toplamı */
  storeTotals: Record<string, number>;
  /** bu satırın yıl geneli toplamı */
  rowTotal: number;
  /** hangi kaynaklar bu satıra katkı yaptı (rozet için) */
  sources: MaviSource[];
  /** veri var mı */
  hasData: boolean;
};

export type MaviReportGroup = {
  key: MasrafGroupKey;
  label: string;
  rowKeys: string[];
  /** ay → mağaza → grup toplamı */
  cells: Record<number, Record<string, number>>;
  storeTotals: Record<string, number>;
  groupTotal: number;
};

export type MaviReport = {
  year: number;
  brand: string;
  title: string;
  fileTag: string;
  store_count: number;
  storeCodes: string[];
  storeNames: Record<string, string>;
  months: readonly { num: number; label: string }[];
  rows: MaviReportRow[];
  groups: MaviReportGroup[];
  /** ay → mağaza → toplam (alt TOPLAM satırı) */
  columnTotals: Record<number, Record<string, number>>;
  /** mağaza kodu → yıl toplamı */
  storeTotals: Record<string, number>;
  /** ay → ay toplamı (tüm mağaza+kategori) */
  monthTotals: Record<number, number>;
  /** genel toplam */
  grandTotal: number;
  /** @deprecated grandTotal ile aynı (eski UI uyumu) */
  autoTotal: number;
  hasAnyData: boolean;
  /** bordro verisi bulunan aylar */
  payrollMonths: number[];
};

export async function buildMaviReport(prisma: PrismaClient, year: number, brandKey = "mavi"): Promise<MaviReport> {
  const brand = getMasrafBrand(brandKey);
  const m = await masrafMatrix(prisma, year, brandKey);
  const codes = brand.stores.map((s) => s.code);
  const storeNames = Object.fromEntries(brand.stores.map((s) => [s.code, s.label]));

  const columnTotals: Record<number, Record<string, number>> = {};
  const storeTotals: Record<string, number> = Object.fromEntries(codes.map((c) => [c, 0]));
  const monthTotals: Record<number, number> = {};
  let grandTotal = 0;

  const rows: MaviReportRow[] = brand.rows.map((def) => {
    const byMonth = m.matrix[def.key];
    const cells: Record<number, Record<string, MatrixCell>> = {};
    const rowStoreTotals: Record<string, number> = Object.fromEntries(codes.map((c) => [c, 0]));
    let rowTotal = 0;
    const srcSet = new Set<MasrafSource>();

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
          for (const s of MASRAF_SOURCES) if (cell[s]) srcSet.add(s);
          const colByStore = (columnTotals[month] ??= {});
          colByStore[code] = round2((colByStore[code] ?? 0) + cell.total);
          storeTotals[code] = round2((storeTotals[code] ?? 0) + cell.total);
          monthTotals[month] = round2((monthTotals[month] ?? 0) + cell.total);
        }
      }
    }
    grandTotal = round2(grandTotal + rowTotal);
    return { ...def, cells, storeTotals: rowStoreTotals, rowTotal, sources: MASRAF_SOURCES.filter((s) => srcSet.has(s)), hasData: rowTotal !== 0 };
  });

  const groups: MaviReportGroup[] = MASRAF_GROUPS.map((g) => {
    const grows = rows.filter((r) => r.group === g.key);
    const cells: Record<number, Record<string, number>> = {};
    const st: Record<string, number> = Object.fromEntries(codes.map((c) => [c, 0]));
    let total = 0;
    for (const r of grows) {
      for (const [mStr, byStore] of Object.entries(r.cells)) {
        for (const [code, cell] of Object.entries(byStore)) {
          const c = (cells[Number(mStr)] ??= {});
          c[code] = round2((c[code] ?? 0) + cell.total);
        }
      }
      for (const code of codes) st[code] = round2((st[code] ?? 0) + (r.storeTotals[code] ?? 0));
      total = round2(total + r.rowTotal);
    }
    return { key: g.key, label: g.label, rowKeys: grows.map((r) => r.key), cells, storeTotals: st, groupTotal: total };
  });

  return {
    year,
    brand: brandKey,
    title: brand.title,
    fileTag: brand.fileTag,
    store_count: m.store_count,
    storeCodes: codes,
    storeNames,
    months: MAVI_MONTHS,
    rows,
    groups,
    columnTotals,
    storeTotals,
    monthTotals,
    grandTotal,
    autoTotal: grandTotal,
    hasAnyData: rows.some((r) => r.hasData),
    payrollMonths: m.payroll_months,
  };
}

export type MaviReportType = Awaited<ReturnType<typeof buildMaviReport>>;
