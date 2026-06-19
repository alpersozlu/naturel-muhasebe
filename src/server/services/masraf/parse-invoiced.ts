import "server-only";
import ExcelJS from "exceljs";
import { categorizeMasraf, type MasrafKategori } from "@/lib/masraf/categorize";
import { convertToTRY } from "@/server/services/fx/kktcmb";

/**
 * Faturalı Masraflar (şirket kartı) Excel'ini parse eder.
 * Format (Dosya 2): her ay bir sayfa (OCAK..ARALIK), gün gün satırlar,
 * `Tarih | MASRAF | AÇIKLAMA | MASRAF | AÇIKLAMA | ...` (çoklu çift).
 *
 * Her masraf: kategorize edilir + $/£/€ ise KKTCMB satış kuruyla TL'ye çevrilir.
 * KİRA için açıklamadaki ay adı "ait olduğu ay" olarak parse edilir.
 */

const AY_NO: Record<string, number> = {
  OCAK: 1, SUBAT: 2, ŞUBAT: 2, MART: 3, NISAN: 4, NİSAN: 4, MAYIS: 5, MAYİS: 5,
  HAZIRAN: 6, TEMMUZ: 7, AGUSTOS: 8, AĞUSTOS: 8, EYLUL: 9, EYLÜL: 9,
  EKIM: 10, EKİM: 10, KASIM: 11, ARALIK: 12,
};
const AY_AD = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
// Açıklamadaki ay adı tespiti için (kira "ait olduğu ay")
const AY_PARSE: [RegExp, number][] = [
  [/ocak/i, 1], [/[şs]ubat/i, 2], [/mart/i, 3], [/nisan/i, 4], [/may[ıi]s/i, 5],
  [/haziran/i, 6], [/temmuz/i, 7], [/a[ğg]ustos/i, 8], [/eyl[üu]l/i, 9],
  [/ekim/i, 10], [/kas[ıi]m/i, 11], [/aral[ıi]k/i, 12],
];

export type ParsedItem = {
  expense_date: string; // YYYY-MM-DD
  raw_description: string;
  amount_original: number;
  currency: "TRY" | "USD" | "EUR" | "GBP";
  fx_rate: number | null;
  fx_rate_date: string | null;
  amount_try: number;
  fx_failed: boolean;
  category: MasrafKategori;
  auto_category: MasrafKategori;
  needs_review: boolean;
  belongs_month: number | null;
};

export type ParsedMonth = {
  month: number;
  month_label: string;
  items: ParsedItem[];
  total_try: number;
};

function detectAmountCurrency(
  raw: unknown
): { amount: number; currency: "TRY" | "USD" | "EUR" | "GBP" } | null {
  if (typeof raw === "number") {
    return raw > 0 ? { amount: raw, currency: "TRY" } : null;
  }
  if (raw == null) return null;
  const s = String(raw).trim();
  const num = parseFloat(s.replace(/[^0-9.,]/g, "").replace(",", "."));
  if (!Number.isFinite(num) || num <= 0) return null;
  if (/\$|usd/i.test(s)) return { amount: num, currency: "USD" };
  if (/£|gbp|sterlin/i.test(s)) return { amount: num, currency: "GBP" };
  if (/€|eur/i.test(s)) return { amount: num, currency: "EUR" };
  return { amount: num, currency: "TRY" };
}

function parseBelongsMonth(desc: string): number | null {
  for (const [re, no] of AY_PARSE) if (re.test(desc)) return no;
  return null;
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function parseInvoicedExcel(
  buffer: Buffer | ArrayBuffer
): Promise<ParsedMonth[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const months: ParsedMonth[] = [];

  for (const ws of wb.worksheets) {
    const month = AY_NO[ws.name.trim().toLocaleUpperCase("tr")];
    if (!month) continue;

    // Header: "MASRAF" sütunlarını bul (sonraki sütun = AÇIKLAMA)
    const pairs: [number, number][] = [];
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, col) => {
      if (String(cell.value ?? "").trim().toLocaleUpperCase("tr") === "MASRAF") {
        pairs.push([col, col + 1]);
      }
    });
    if (pairs.length === 0) continue;

    const items: ParsedItem[] = [];
    ws.eachRow((row, rn) => {
      if (rn === 1) return;
      const dateVal = row.getCell(1).value;
      if (!(dateVal instanceof Date)) return;
      const expense_date = toIso(dateVal);
      for (const [mc, ac] of pairs) {
        const amtRaw = row.getCell(mc).value;
        const descRaw = row.getCell(ac).value;
        const desc = String(descRaw ?? "").trim();
        if (!desc || desc === "-") continue;
        const ac2 = detectAmountCurrency(amtRaw);
        if (!ac2) continue;
        const cat = categorizeMasraf(desc);
        items.push({
          expense_date,
          raw_description: desc,
          amount_original: ac2.amount,
          currency: ac2.currency,
          fx_rate: null,
          fx_rate_date: null,
          amount_try: ac2.amount, // FX sonra
          fx_failed: false,
          category: cat.category,
          auto_category: cat.category,
          needs_review: cat.needsReview,
          belongs_month: cat.category === "KIRA" ? parseBelongsMonth(desc) : null,
        });
      }
    });

    months.push({ month, month_label: AY_AD[month], items, total_try: 0 });
  }

  // FX çevrimi — yabancı para satırları için KKTCMB satış kuru.
  // Paralel: çok döviz satırında bile tek turda (dayCache tekrar isteği önler),
  // Vercel timeout riskini azaltır.
  await Promise.all(
    months.flatMap((m) =>
      m.items.map(async (it) => {
        const fx = await convertToTRY(
          it.amount_original,
          it.currency,
          new Date(`${it.expense_date}T00:00:00.000Z`)
        );
        it.amount_try = Math.round(fx.amountTRY * 100) / 100;
        it.fx_rate = it.currency === "TRY" ? null : fx.rate;
        it.fx_rate_date = fx.rateDate
          ? `${fx.rateDate.slice(0, 4)}-${fx.rateDate.slice(4, 6)}-${fx.rateDate.slice(6, 8)}`
          : null;
        it.fx_failed = !fx.converted;
      })
    )
  );
  for (const m of months) {
    m.total_try = Math.round(m.items.reduce((s, it) => s + it.amount_try, 0) * 100) / 100;
  }

  return months;
}
