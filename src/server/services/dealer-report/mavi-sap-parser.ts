import "server-only";
import * as XLSX from "xlsx";
import { createHash } from "crypto";

/**
 * Mavi SAP "Bayi Gün Sonu" export (sheet "SAPUI5 dışa aktarımı").
 *
 * Layout, measured on 14 real exports / 15.093 receipts (March–July 2026) and
 * checked to the kuruş against three store summaries already on file
 * (Güzelyurt 16.05 and 22.05, Girne 17.05):
 *
 *  - One row per product line. Receipt = (Mağaza, Belge Tarihi, Referans No).
 *  - Exactly ONE line of each receipt is its "head" row: it carries Tahsilat,
 *    Toplam Tutar, Nakit and the bank "Tutar" columns; the other lines have 0
 *    there.
 *  - "Kartuş Kart" and "Hediye Kart" are REPEATED on every line of the receipt
 *    with the same value. Summing them over lines (what this parser did before)
 *    counts a 3-line receipt's Kartuş three times — it must be taken once per
 *    receipt.
 *  - Per receipt: Toplam Tutar = Nakit + Σ bank Tutar + Hediye + Kartuş
 *    + Havale + Diğer, and Σ line Net Tutar = Toplam Tutar. Held for all
 *    15.093 receipts.
 *  - Refunds ("Refereanslı İade") carry negative amounts, so plain sums net
 *    them out.
 *  - The September 2026 export renamed a few headers ("Nakit" → "Tutar",
 *    "SiraNo" → "Sıra No", "Stok Kdv" → "Stok KDV") and added "Açıklama" and
 *    "Seçme kutusu"; columns are therefore located by normalized name and,
 *    for cash, by position.
 *  - Per day: Σ Toplam = summary "Toplam Satış", Σ Nakit = summary nakit,
 *    Σ bank = summary kredi kartı, Σ Kartuş (once per receipt) = summary Kartuş.
 *
 * Headers are matched case- and whitespace-insensitively: the live export
 * says "Belge Tarihi" while the first version of this parser demanded
 * "Belge tarihi", so no real file was ever accepted. Dates are read as Excel
 * serial numbers and converted with integer arithmetic — no time zone is
 * involved, so the day cannot slip on a server that is not on UTC.
 *
 * PER-SALESPERSON REVENUE (03.10.2026). Every line carries "Satış Temsilcisi"
 * (+ "Adı") and "Stok KDV Matrahı" (the line's amount without VAT). SAP's
 * "Net Ciro" — the figure commissions are paid on — is
 *     Σ Stok KDV Matrahı − Kartuş
 * with the receipt's Kartuş (points redeemed, once per receipt) shared among
 * its lines by their Net Tutar. Checked to the kuruş against the payroll
 * masters: Girne August 2026 (store 3.575.185,04 and all four sales
 * assistants exact), Güzelyurt July and August 2026 (store and assistants
 * within the master's whole-lira rounding). Hediye Kart is NOT deducted.
 *
 * DENIM ESTIMATE. Denim earns three times the commission rate, but the export
 * has no product-group column, so "denim" cannot be read off it exactly. It
 * can be approximated — see looksLikeDenim. Against the KPI report's own denim
 * figure the estimate lands within ±3 % for 9 of 11 person-months (Girne
 * August + September, Güzelyurt August 2026; mean 1,7 %, worst 6,3 %). Good
 * enough to notice a KPI file whose denim was inflated; never used to pay.
 */
export const MAVI_STORE_CODE_MAP: Record<string, string> = {
  "9400": "Lefkoşa",
  "9401": "Girne",
  "9402": "Mağusa",
  "9403": "Güzelyurt",
};

const DENIM_GROUPS = new Set(["M00", "M04", "M10", "M13", "M14"]);
const GARMENT_WORD = /PANTOLON|ŞORT|ETEK|ELB[İI]SE|CEKET|YELEK|TULUM|EŞOFMAN/;

/**
 * Denim bottoms carry a FIT name ("MARLON Classic Denim", "SIENA Dark Used",
 * "TIM 90's Used") where every other garment carries a Turkish description
 * ("DOKUMA PANTOLON", "MODELLİ DOKUMA ŞORT"), and they sit in five material
 * groups: M00 / M04 (men's trousers, shorts) and M10 / M13 / M14 (women's
 * trousers, skirts, shorts).
 */
export function looksLikeDenim(material: string, name: string): boolean {
  return DENIM_GROUPS.has(material.slice(0, 3).toUpperCase()) && !GARMENT_WORD.test(name.toLocaleUpperCase("tr"));
}

export type ParsedDealerRep = {
  code: string; // "94010050" — "—" when the line has none
  name: string;
  // Amounts keep FOUR decimals (see the rounding note where they are built).
  matrah: number; // Σ Stok KDV Matrahı (KDV hariç)
  net: number; // Σ Net Tutar (KDV dahil)
  kartus: number; // receipt Kartuş shared by Net Tutar
  net_ciro: number; // matrah − kartus  → SAP "Net Ciro"
  units: number; // Σ line Miktar (refunds negative)
  lines: number;
  /** Estimated denim share of net_ciro (see looksLikeDenim); null when the export has no product columns. */
  denim: number | null;
  denim_units: number | null;
};

export type ParsedDealerDay = {
  date: Date; // UTC midnight of the document day
  net_sales: number; // Σ line Net Tutar (= Σ Toplam Tutar), refunds netted
  loyalty: number; // Kartuş, once per receipt
  gift_card: number; // Hediye Kart, once per receipt
  cash: number; // Σ Nakit
  card: number; // Σ bank Tutar columns
  wire: number; // Σ Havale
  other: number; // Σ Diğer
  refund_total: number; // Σ Toplam Tutar of refund receipts (negative)
  transaction_count: number; // receipts
  line_count: number;
  refund_count: number; // refund LINES (kept for continuity)
  /** Receipts whose payments do not add up to their total (should be 0). */
  inconsistent_receipts: number;
  /** Σ Stok KDV Matrahı — 0 when the export has no such column. */
  net_ex_vat: number;
  /** Per salesperson; empty when the export lacks the rep / matrah columns. */
  reps: ParsedDealerRep[];
};

export type ParsedDealerReport = {
  source: "sap";
  store_code: string | null;
  store_name_hint: string | null; // 9402 → "Mağusa"
  source_date_min: Date | null;
  source_date_max: Date | null;
  days: ParsedDealerDay[];
  totals: {
    net_sales: number;
    loyalty: number;
    gift_card: number;
    line_count: number;
  };
};

/** Canonical header key: Turkish-aware lower case, single spaces. */
function normHeader(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");
}

const REQUIRED: Array<{ key: string; label: string }> = [
  { key: "mağaza", label: "Mağaza" },
  { key: "belge tarihi", label: "Belge Tarihi" },
  { key: "işlem tipi", label: "İşlem Tipi" },
  { key: "referans no", label: "Referans No" },
  { key: "net tutar", label: "Net Tutar" },
  { key: "kartuş kart", label: "Kartuş Kart" },
];

export function parseMaviSapBuffer(buffer: Buffer): ParsedDealerReport {
  // cellDates:false → dates stay Excel serials; see parseDay.
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel dosyası boş — sheet bulunamadı");
  const ws = wb.Sheets[sheetName]!;
  // Array-of-arrays: the export repeats column names ("Tutar" ×8,
  // "Banka Kodu" ×7, "Miktar" ×2), which an object-per-row read would rename.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  if (aoa.length < 2) throw new Error("Excel dosyasında veri satırı yok");

  // Header row: normally the first; tolerate a title line or two above it.
  let headerAt = -1;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const keys = (aoa[i] ?? []).map(normHeader);
    if (keys.includes("mağaza") && keys.includes("referans no")) {
      headerAt = i;
      break;
    }
  }
  const headerKeys = (aoa[headerAt === -1 ? 0 : headerAt] ?? []).map(normHeader);
  const missing = REQUIRED.filter((r) => !headerKeys.includes(r.key)).map((r) => r.label);
  if (headerAt === -1 || missing.length > 0) {
    throw new Error(
      `Bu dosya Mavi SAP bayi raporu formatında değil. Eksik kolonlar: ${(missing.length
        ? missing
        : REQUIRED.map((r) => r.label)
      ).join(", ")}`
    );
  }

  const col = (key: string) => headerKeys.indexOf(key);
  const cStore = col("mağaza");
  const cDate = col("belge tarihi");
  const cType = col("işlem tipi");
  const cRef = col("referans no");
  const cNet = col("net tutar");
  const cLoyalty = col("kartuş kart");
  const cGift = col("hediye kart");
  const cHead = col("tahsilat");
  const cTotal = col("toplam tutar");
  // Cash: named "Nakit" in the exports up to July 2026; the September 2026
  // export renamed it to a bare "Tutar" (measured on the live Lefkoşa files of
  // 18–19.09: that column summed to the summary's nakit to the kuruş). In both
  // layouts it is the amount column right before "Para Birimi".
  let cCash = col("nakit");
  if (cCash < 0) {
    const cCurrency = col("para birimi");
    if (cCurrency > 0 && headerKeys[cCurrency - 1] === "tutar") cCash = cCurrency - 1;
  }
  const cWire = col("havale");
  const cOther = col("diğer");
  // Bank amounts: each "Tutar" that directly follows a "Banka Kodu". The
  // trailing stand-alone "Tutar" is the receipt total again — not a payment.
  const bankCols: number[] = [];
  headerKeys.forEach((k, i) => {
    if (k === "tutar" && headerKeys[i - 1] === "banka kodu") bankCols.push(i);
  });

  // Per-salesperson columns (optional — older layouts may lack them).
  const cMatrah = headerKeys.findIndex((k) => k.startsWith("stok kdv matrah"));
  const cRepCode = col("satış temsilcisi");
  const cRepName = col("satış temsilcisi adı");
  const qtyCols = headerKeys.map((k, i) => (k === "miktar" ? i : -1)).filter((i) => i >= 0);
  const cQty = qtyCols.length ? qtyCols[qtyCols.length - 1]! : -1; // line quantity is the later "Miktar"
  const repsAvailable = cMatrah >= 0 && cRepName >= 0;
  const cMaterial = col("malzeme");
  const cProduct = col("adı"); // the product name; "Satış Temsilcisi Adı" is a different key
  const denimAvailable = cMaterial >= 0 && cProduct >= 0;

  type Receipt = {
    dayKey: string;
    lines: number;
    net: number;
    isRefund: boolean;
    head: unknown[] | null;
    first: unknown[];
    items: Array<{ code: string; name: string; matrah: number; net: number; qty: number; denim: boolean }>;
  };
  const receipts = new Map<string, Receipt>();
  const storeCodes = new Set<string>();
  let dataRows = 0;

  for (const row of aoa.slice(headerAt + 1)) {
    if (!row || row.every((v) => v === null || v === "")) continue;
    const store = toStr(row[cStore]);
    const date = parseDay(row[cDate]);
    if (!store || !date) continue; // footer / total line
    dataRows++;
    storeCodes.add(store);
    const dayKey = isoDate(date);
    const ref = toStr(row[cRef]) || `satir-${dataRows}`;
    const key = `${store}|${dayKey}|${ref}`;
    let r = receipts.get(key);
    if (!r) {
      r = { dayKey, lines: 0, net: 0, isRefund: false, head: null, first: row, items: [] };
      receipts.set(key, r);
    }
    r.lines += 1;
    r.net += toNum(row[cNet]);
    if (repsAvailable) {
      r.items.push({
        code: (cRepCode >= 0 ? toStr(row[cRepCode]) : "") || "—",
        name: toStr(row[cRepName]) || "—",
        matrah: toNum(row[cMatrah]),
        net: toNum(row[cNet]),
        qty: cQty >= 0 ? toNum(row[cQty]) : 0,
        denim: denimAvailable && looksLikeDenim(toStr(row[cMaterial]), toStr(row[cProduct])),
      });
    }
    if (toStr(row[cType]).toLocaleLowerCase("tr").includes("iade")) r.isRefund = true;
    if (cHead >= 0 && row[cHead] !== null && row[cHead] !== "" && !r.head) r.head = row;
  }

  if (dataRows === 0) throw new Error("Excel dosyasında veri satırı yok");
  if (storeCodes.size === 0) throw new Error("Dosyada Mağaza kodu bulunamadı");
  if (storeCodes.size > 1) {
    throw new Error(
      `Dosyada birden fazla mağaza kodu var (${Array.from(storeCodes).join(", ")}). Tek mağazalı rapor bekleniyor.`
    );
  }
  const storeCode = Array.from(storeCodes)[0]!;

  const byDay = new Map<string, ParsedDealerDay>();
  const repsByDay = new Map<string, Map<string, ParsedDealerRep>>();
  for (const r of Array.from(receipts.values())) {
    let d = byDay.get(r.dayKey);
    if (!d) {
      d = {
        date: new Date(`${r.dayKey}T00:00:00.000Z`),
        net_sales: 0,
        loyalty: 0,
        gift_card: 0,
        cash: 0,
        card: 0,
        wire: 0,
        other: 0,
        refund_total: 0,
        transaction_count: 0,
        line_count: 0,
        refund_count: 0,
        inconsistent_receipts: 0,
        net_ex_vat: 0,
        reps: [],
      };
      byDay.set(r.dayKey, d);
      repsByDay.set(r.dayKey, new Map());
    }
    // Receipt-level amounts come from the head row; Kartuş / Hediye are the
    // same on every line, so the first line serves when no head is marked.
    const src = r.head ?? r.first;
    const at = (c: number) => (c >= 0 ? toNum(src[c]) : 0);
    const loyalty = at(cLoyalty);
    const gift = at(cGift);
    const cash = r.head ? at(cCash) : 0;
    const card = r.head ? bankCols.reduce((s, c) => s + toNum(r.head![c]), 0) : 0;
    const wire = r.head ? at(cWire) : 0;
    const other = r.head ? at(cOther) : 0;

    // Per salesperson: the receipt's Kartuş is shared by each line's Net Tutar.
    if (r.items.length > 0) {
      const reps = repsByDay.get(r.dayKey)!;
      for (const it of r.items) {
        const share = Math.abs(r.net) > 0.005 ? it.net / r.net : 1 / r.items.length;
        let p = reps.get(it.code);
        if (!p) {
          p = {
            code: it.code,
            name: it.name,
            matrah: 0,
            net: 0,
            kartus: 0,
            net_ciro: 0,
            units: 0,
            lines: 0,
            denim: denimAvailable ? 0 : null,
            denim_units: denimAvailable ? 0 : null,
          };
          reps.set(it.code, p);
        }
        p.matrah += it.matrah;
        p.net += it.net;
        p.kartus += loyalty * share;
        p.units += it.qty;
        p.lines += 1;
        if (it.denim) {
          p.denim = (p.denim ?? 0) + it.matrah - loyalty * share;
          p.denim_units = (p.denim_units ?? 0) + it.qty;
        }
        d.net_ex_vat += it.matrah;
      }
    }

    d.net_sales += r.net;
    d.loyalty += loyalty;
    d.gift_card += gift;
    d.cash += cash;
    d.card += card;
    d.wire += wire;
    d.other += other;
    d.transaction_count += 1;
    d.line_count += r.lines;
    if (r.isRefund) {
      d.refund_count += r.lines;
      d.refund_total += r.net;
    }
    if (r.head && cTotal >= 0) {
      const total = toNum(r.head[cTotal]);
      const paid = cash + card + gift + loyalty + wire + other;
      if (Math.abs(total - paid) > 0.05 || Math.abs(total - r.net) > 0.05) d.inconsistent_receipts += 1;
    }
  }

  // Safety net for the next silent header change: when the receipts' own
  // totals are present but the payments read from the file do not add up to
  // them, a payment column was not recognised — say so instead of storing a
  // zero that later reads as "cash missing".
  const unbalanced = Array.from(byDay.values()).filter(
    (d) => d.transaction_count > 0 && d.inconsistent_receipts / d.transaction_count > 0.05
  );
  if (cTotal >= 0 && unbalanced.length > 0) {
    throw new Error(
      "SAP raporundaki ödeme kolonları tanınamadı (fiş toplamları ödemelerle tutmuyor). Dosya biçimi değişmiş olabilir — yöneticinize haber verin."
    );
  }

  const days = Array.from(byDay.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((d) => ({
      ...d,
      net_sales: round2(d.net_sales),
      loyalty: round2(d.loyalty),
      gift_card: round2(d.gift_card),
      cash: round2(d.cash),
      card: round2(d.card),
      wire: round2(d.wire),
      other: round2(d.other),
      refund_total: round2(d.refund_total),
      net_ex_vat: round2(d.net_ex_vat),
      reps: Array.from(repsByDay.get(isoDate(d.date))?.values() ?? [])
        // Four decimals: the Kartuş share is a fraction of a kuruş per line,
        // and a month is ~30 of these per person — rounding each day to the
        // kuruş would let the month total drift off SAP's own figure.
        .map((p) => ({
          ...p,
          matrah: round4(p.matrah),
          net: round4(p.net),
          kartus: round4(p.kartus),
          net_ciro: round4(p.matrah - p.kartus),
          units: round2(p.units),
          denim: p.denim == null ? null : round4(p.denim),
          denim_units: p.denim_units == null ? null : round2(p.denim_units),
        }))
        .sort((a, b) => b.net_ciro - a.net_ciro),
    }));

  return {
    source: "sap",
    store_code: storeCode,
    store_name_hint: MAVI_STORE_CODE_MAP[storeCode] ?? null,
    source_date_min: days[0]?.date ?? null,
    source_date_max: days[days.length - 1]?.date ?? null,
    days,
    totals: {
      net_sales: round2(days.reduce((s, d) => s + d.net_sales, 0)),
      loyalty: round2(days.reduce((s, d) => s + d.loyalty, 0)),
      gift_card: round2(days.reduce((s, d) => s + d.gift_card, 0)),
      line_count: dataRows,
    },
  };
}

/** The selected day's figures, or null when the file does not cover it. */
export function pickDay(report: ParsedDealerReport, targetDate: Date) {
  const targetKey = isoDate(targetDate);
  return report.days.find((d) => isoDate(d.date) === targetKey) ?? null;
}

/**
 * Several days of one export as ONE figure — a merged register ("Kasa
 * Birleşmesi": the register could not be closed, so the days are closed
 * together under a single store summary). Every amount is the sum over the
 * days in [start, end]; salespeople are merged by code; the date is `end`,
 * the day the summary and this report sit on. Null when the export has no
 * row in the range. Days without rows are simply absent (a register that was
 * down all day has nothing dated that day).
 */
export function pickRange(report: ParsedDealerReport, start: Date, end: Date): ParsedDealerDay | null {
  const a = isoDate(start);
  const b = isoDate(end);
  return pickDays(
    report,
    report.days.map((d) => isoDate(d.date)).filter((k) => k >= a && k <= b),
    end
  );
}

/** The given days (YYYY-MM-DD) of one export as one figure, dated `asOf`. */
export function pickDays(report: ParsedDealerReport, isoDates: string[], asOf: Date): ParsedDealerDay | null {
  const wanted = new Set(isoDates);
  const b = isoDate(asOf);
  const days = report.days.filter((d) => wanted.has(isoDate(d.date)));
  if (days.length === 0) return null;
  const sum = (f: (d: ParsedDealerDay) => number) => days.reduce((s, d) => s + f(d), 0);
  const reps = new Map<string, ParsedDealerRep>();
  for (const d of days) {
    for (const p of d.reps) {
      const cur = reps.get(p.code);
      if (!cur) {
        reps.set(p.code, { ...p });
        continue;
      }
      cur.name = p.name; // days are in date order — the latest spelling wins
      cur.matrah += p.matrah;
      cur.net += p.net;
      cur.kartus += p.kartus;
      cur.net_ciro += p.net_ciro;
      cur.units += p.units;
      cur.lines += p.lines;
      cur.denim = cur.denim == null || p.denim == null ? null : cur.denim + p.denim;
      cur.denim_units = cur.denim_units == null || p.denim_units == null ? null : cur.denim_units + p.denim_units;
    }
  }
  return {
    date: new Date(`${b}T00:00:00.000Z`),
    net_sales: round2(sum((d) => d.net_sales)),
    loyalty: round2(sum((d) => d.loyalty)),
    gift_card: round2(sum((d) => d.gift_card)),
    cash: round2(sum((d) => d.cash)),
    card: round2(sum((d) => d.card)),
    wire: round2(sum((d) => d.wire)),
    other: round2(sum((d) => d.other)),
    refund_total: round2(sum((d) => d.refund_total)),
    transaction_count: sum((d) => d.transaction_count),
    line_count: sum((d) => d.line_count),
    refund_count: sum((d) => d.refund_count),
    inconsistent_receipts: sum((d) => d.inconsistent_receipts),
    net_ex_vat: round2(sum((d) => d.net_ex_vat)),
    reps: Array.from(reps.values())
      .map((p) => ({
        ...p,
        matrah: round4(p.matrah),
        net: round4(p.net),
        kartus: round4(p.kartus),
        net_ciro: round4(p.net_ciro),
        units: round2(p.units),
        denim: p.denim == null ? null : round4(p.denim),
        denim_units: p.denim_units == null ? null : round2(p.denim_units),
      }))
      .sort((x, y) => y.net_ciro - x.net_ciro),
  };
}

/** A dealer report already on file for one day (what DealerDailyReport stores). */
export type StoredDealerTotals = {
  net_sales: number;
  loyalty: number;
  gift_card: number;
  cash: number;
  card: number;
  wire: number;
  other: number;
  refund_total: number;
  transaction_count: number;
  line_count: number;
  refund_count: number;
};

/**
 * The SAP total of a MERGED group of days, as stored on its last day.
 *
 * Stores export this file one day at a time, but a range export works too, so
 * the total is composed from whatever is on file — each day exactly once:
 *
 *   rows of THIS file for the last day (required)
 * + rows of THIS file for earlier days that have no dealer file of their own
 * + the stored report of every earlier day that has its own file
 *
 * Null when the file has no row for the last day.
 */
export function mergedDealerDay(
  report: ParsedDealerReport,
  lastDay: Date,
  earlier: Array<{ iso: string; own: StoredDealerTotals | null }>
): { day: ParsedDealerDay; file_days: string[]; from_own_reports: string[] } | null {
  const lastIso = isoDate(lastDay);
  if (!report.days.some((d) => isoDate(d.date) === lastIso)) return null;
  const uncovered = earlier.filter((e) => e.own === null).map((e) => e.iso);
  const own = earlier.filter((e): e is { iso: string; own: StoredDealerTotals } => e.own !== null);
  const filePart = pickDays(report, [...uncovered, lastIso], lastDay)!;
  const plus = (pick: (t: StoredDealerTotals) => number) => own.reduce((s, e) => s + pick(e.own), 0);
  return {
    day: {
      ...filePart,
      net_sales: round2(filePart.net_sales + plus((t) => t.net_sales)),
      loyalty: round2(filePart.loyalty + plus((t) => t.loyalty)),
      gift_card: round2(filePart.gift_card + plus((t) => t.gift_card)),
      cash: round2(filePart.cash + plus((t) => t.cash)),
      card: round2(filePart.card + plus((t) => t.card)),
      wire: round2(filePart.wire + plus((t) => t.wire)),
      other: round2(filePart.other + plus((t) => t.other)),
      refund_total: round2(filePart.refund_total + plus((t) => t.refund_total)),
      transaction_count: filePart.transaction_count + plus((t) => t.transaction_count),
      line_count: filePart.line_count + plus((t) => t.line_count),
      refund_count: filePart.refund_count + plus((t) => t.refund_count),
    },
    file_days: report.days.map((d) => isoDate(d.date)).filter((k) => k === lastIso || uncovered.includes(k)),
    from_own_reports: own.map((e) => e.iso),
  };
}

/** Content fingerprint — replay guard. */
export function dealerReportFingerprint(
  storeCode: string,
  date: Date,
  netSales: number,
  txCount: number
): string {
  const raw = `${storeCode}|${isoDate(date)}|${netSales.toFixed(2)}|${txCount}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

// ───── helpers ─────

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Text cells: "1.234,56" (Turkish) or "1234.56".
  let s = String(v).trim().replace(/\s/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Document day as UTC midnight, from an Excel serial, a Date or text. */
function parseDay(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel serial: whole days since 1899-12-30. Pure arithmetic.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // A Date built from a local midnight sits just before/after the UTC day
    // line; rounding to the nearest day recovers the intended date.
    return new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
  }
  if (typeof v === "string") {
    const s = v.trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
