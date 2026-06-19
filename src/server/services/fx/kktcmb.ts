import "server-only";

/**
 * KKTC Merkez Bankası tarih bazlı döviz kuru servisi.
 *
 * Kaynak: https://mb.gov.ct.tr/kur/tarih/YYYYMMDD  (XML, 09/04/2011+)
 * Faturalı masraf yüklemede $/£/€ tutarlar, masrafın TARİHİNDEKİ
 * **satış (Doviz_Satis)** kuruyla TL'ye çevrilir (Alper mutabakatı 2026-06-19).
 *
 * Hafta sonu/tatilde KKTCMB son geçerli kuru döndürür; yine de eksik veriye
 * karşı 7 güne kadar geriye gideriz.
 */

type DayRates = Record<string, { satis: number; birim: number }>;

// Request-ömürlü cache — bir yüklemede aynı tarih tekrar tekrar çekilmesin.
const dayCache = new Map<string, DayRates | null>();

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function fetchDay(yyyymmdd: string): Promise<DayRates | null> {
  if (dayCache.has(yyyymmdd)) return dayCache.get(yyyymmdd)!;
  let result: DayRates | null = null;
  try {
    const res = await fetch(`https://mb.gov.ct.tr/kur/tarih/${yyyymmdd}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const xml = await res.text();
      if (xml.includes("<Resmi_Kur>")) {
        const out: DayRates = {};
        for (const block of xml.split("<Resmi_Kur>").slice(1)) {
          const sym = block.match(/<Sembol>([^<]+)<\/Sembol>/)?.[1]?.trim();
          const satis = block.match(/<Doviz_Satis>([\d.]+)<\/Doviz_Satis>/)?.[1];
          const birim = block.match(/<Birim>([\d.]+)<\/Birim>/)?.[1];
          if (sym && satis) {
            out[sym] = {
              satis: parseFloat(satis),
              birim: birim ? parseFloat(birim) : 1,
            };
          }
        }
        if (Object.keys(out).length) result = out;
      }
    }
  } catch {
    result = null;
  }
  dayCache.set(yyyymmdd, result);
  return result;
}

export type FxResult = {
  /** 1 birim dövizin TL satış karşılığı (birim faktörü uygulanmış). */
  rate: number;
  /** Kurun alındığı gerçek tarih (hafta sonu fallback olabilir), YYYYMMDD. */
  rateDate: string;
};

/** Para birimi TL/TRY değil mi? */
export function isForeignCurrency(currency: string): boolean {
  const c = currency.trim().toUpperCase();
  return c !== "TRY" && c !== "TL" && c !== "";
}

/**
 * Verilen tarihteki KKTCMB satış kuruyla 1 birim dövizin TL karşılığı.
 * TRY → 1. Bulunamazsa (servis erişilemez vb.) null.
 */
export async function getKktcmbSellingRate(
  date: Date,
  currency: string
): Promise<FxResult | null> {
  const cur = currency.trim().toUpperCase();
  if (cur === "TRY" || cur === "TL") return { rate: 1, rateDate: ymd(date) };
  for (let i = 0; i < 7; i++) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - i);
    const rates = await fetchDay(ymd(d));
    if (rates && rates[cur]) {
      return { rate: rates[cur].satis / (rates[cur].birim || 1), rateDate: ymd(d) };
    }
  }
  return null;
}

/**
 * Tutarı TL'ye çevirir. Yabancı para ve kur bulunduysa çevirir; bulunamazsa
 * `converted=false` döner (UI manuel kur/işaret isteyebilir).
 */
export async function convertToTRY(
  amount: number,
  currency: string,
  date: Date
): Promise<{ amountTRY: number; rate: number; rateDate: string | null; converted: boolean }> {
  if (!isForeignCurrency(currency)) {
    return { amountTRY: amount, rate: 1, rateDate: null, converted: true };
  }
  const fx = await getKktcmbSellingRate(date, currency);
  if (!fx) {
    return { amountTRY: amount, rate: 0, rateDate: null, converted: false };
  }
  return {
    amountTRY: amount * fx.rate,
    rate: fx.rate,
    rateDate: fx.rateDate,
    converted: true,
  };
}
