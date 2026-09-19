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
 *  - Per day: Σ Toplam = summary "Toplam Satış", Σ Nakit = summary nakit,
 *    Σ bank = summary kredi kartı, Σ Kartuş (once per receipt) = summary Kartuş.
 *
 * Headers are matched case- and whitespace-insensitively: the live export
 * says "Belge Tarihi" while the first version of this parser demanded
 * "Belge tarihi", so no real file was ever accepted. Dates are read as Excel
 * serial numbers and converted with integer arithmetic — no time zone is
 * involved, so the day cannot slip on a server that is not on UTC.
 */
export const MAVI_STORE_CODE_MAP: Record<string, string> = {
  "9400": "Lefkoşa",
  "9401": "Girne",
  "9402": "Mağusa",
  "9403": "Güzelyurt",
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
  const cCash = col("nakit");
  const cWire = col("havale");
  const cOther = col("diğer");
  // Bank amounts: each "Tutar" that directly follows a "Banka Kodu". The
  // trailing stand-alone "Tutar" is the receipt total again — not a payment.
  const bankCols: number[] = [];
  headerKeys.forEach((k, i) => {
    if (k === "tutar" && headerKeys[i - 1] === "banka kodu") bankCols.push(i);
  });

  type Receipt = {
    dayKey: string;
    lines: number;
    net: number;
    isRefund: boolean;
    head: unknown[] | null;
    first: unknown[];
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
      r = { dayKey, lines: 0, net: 0, isRefund: false, head: null, first: row };
      receipts.set(key, r);
    }
    r.lines += 1;
    r.net += toNum(row[cNet]);
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
      };
      byDay.set(r.dayKey, d);
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
