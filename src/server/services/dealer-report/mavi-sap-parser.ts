import "server-only";
import * as XLSX from "xlsx";
import { createHash } from "crypto";

/**
 * Mavi mağaza kodu → mağaza adı eşleştirme.
 * Sistem mağaza tablosundaki name ile karşılaştırarak doğru store_id'yi bulur.
 */
export const MAVI_STORE_CODE_MAP: Record<string, string> = {
  "9400": "Lefkoşa",
  "9401": "Girne",
  "9402": "Mağusa",
  "9403": "Güzelyurt",
};

export type ParsedDealerReport = {
  source: "sap";
  store_code: string | null;
  store_name_hint: string | null; // 9402 → "Mağusa"
  source_date_min: Date | null;
  source_date_max: Date | null;
  // Tüm günler (filtre öncesi)
  days: Array<{
    date: Date;
    net_sales: number;
    loyalty: number;
    gift_card: number;
    transaction_count: number;
    line_count: number;
    refund_count: number;
  }>;
  // Toplam (sadece istatistik için, gün filtresi öncesi)
  totals: {
    net_sales: number;
    loyalty: number;
    gift_card: number;
    line_count: number;
  };
};

const REQUIRED_COLUMNS = [
  "Mağaza",
  "Belge tarihi",
  "İşlem Tipi",
  "Referans No",
  "Net Tutar",
  "Kartuş Kart",
] as const;

/** Excel buffer'ını parse eder. Tek sheet (genelde "SAPUI5 dışa aktarımı"). */
export function parseMaviSapBuffer(buffer: Buffer): ParsedDealerReport {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel dosyası boş — sheet bulunamadı");
  }
  const ws = wb.Sheets[sheetName]!;
  // header: 1 → array of arrays (ilk satır başlık olarak işlenir)
  // raw: true → tip dönüşümü yapma, ham değerler
  // defval: null → boş hücreler null
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });

  if (rows.length === 0) {
    throw new Error("Excel dosyasında veri satırı yok");
  }

  // Header doğrulama (Mavi SAP formatı mı?)
  const headers = Object.keys(rows[0]!);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `Bu dosya Mavi SAP bayi raporu formatında değil. Eksik kolonlar: ${missing.join(", ")}`
    );
  }

  // Tek mağaza beklenir (müdür kendi mağazası dosyasını yükler)
  const storeCodes = new Set<string>();
  const byDate = new Map<
    string,
    {
      date: Date;
      net_sales: number;
      loyalty: number;
      gift_card: number;
      refs: Set<string>;
      line_count: number;
      refund_count: number;
    }
  >();

  let totalNet = 0;
  let totalLoyalty = 0;
  let totalGift = 0;

  for (const row of rows) {
    const storeCode = toStr(row["Mağaza"]);
    if (storeCode) storeCodes.add(storeCode);

    const dateRaw = row["Belge tarihi"];
    const date = parseDate(dateRaw);
    if (!date) continue;

    const key = isoDate(date);
    const net = toNum(row["Net Tutar"]);
    const loyalty = toNum(row["Kartuş Kart"]);
    const gift = toNum(row["Hediye Kart"]);
    const ref = toStr(row["Referans No"]);
    const isRefund = String(row["İşlem Tipi"] ?? "")
      .toLocaleLowerCase("tr")
      .includes("iade");

    totalNet += net;
    totalLoyalty += loyalty;
    totalGift += gift;

    let bucket = byDate.get(key);
    if (!bucket) {
      bucket = {
        date,
        net_sales: 0,
        loyalty: 0,
        gift_card: 0,
        refs: new Set(),
        line_count: 0,
        refund_count: 0,
      };
      byDate.set(key, bucket);
    }
    bucket.net_sales += net;
    bucket.loyalty += loyalty;
    bucket.gift_card += gift;
    bucket.line_count += 1;
    if (ref) bucket.refs.add(ref);
    if (isRefund) bucket.refund_count += 1;
  }

  if (storeCodes.size === 0) {
    throw new Error("Dosyada Mağaza kodu bulunamadı");
  }
  if (storeCodes.size > 1) {
    throw new Error(
      `Dosyada birden fazla mağaza kodu var (${Array.from(storeCodes).join(", ")}). Tek mağazalı rapor bekleniyor.`
    );
  }
  const storeCode = Array.from(storeCodes)[0]!;
  const hint = MAVI_STORE_CODE_MAP[storeCode] ?? null;

  const days = Array.from(byDate.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((d) => ({
      date: d.date,
      net_sales: round2(d.net_sales),
      loyalty: round2(d.loyalty),
      gift_card: round2(d.gift_card),
      transaction_count: d.refs.size,
      line_count: d.line_count,
      refund_count: d.refund_count,
    }));

  return {
    source: "sap",
    store_code: storeCode,
    store_name_hint: hint,
    source_date_min: days[0]?.date ?? null,
    source_date_max: days[days.length - 1]?.date ?? null,
    days,
    totals: {
      net_sales: round2(totalNet),
      loyalty: round2(totalLoyalty),
      gift_card: round2(totalGift),
      line_count: rows.length,
    },
  };
}

/** Dosyayı parse ettikten sonra seçili tarihi için tek gün döner (yoksa null). */
export function pickDay(report: ParsedDealerReport, targetDate: Date) {
  const targetKey = isoDate(targetDate);
  return report.days.find((d) => isoDate(d.date) === targetKey) ?? null;
}

/** İçerik fingerprint — replay guard için */
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
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date — XLSX cellDates:true ile zaten Date olarak gelir,
    // bu kol fallback olarak duruyor
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 24 * 60 * 60 * 1000);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
