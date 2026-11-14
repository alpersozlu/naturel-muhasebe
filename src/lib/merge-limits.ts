/**
 * GÜN BİRLEŞMESİNDE EN ÇOK KAÇ GÜN?
 *
 * Varsayılan 3 gün. Derimod Lefkoşa 4 güne kadar birleştirebilir (sahibi,
 * 14.11.2026). Sınır mağazaya göredir: uzun kapanışlar her mağazada
 * olmuyor, sınırı herkese açmak kasa kontrolünü gevşetir.
 *
 * Mağaza adıyla eşleşir (büyük/küçük harf ve Türkçe karakter farkı önemsiz),
 * çünkü mağaza kimlikleri ortamdan ortama değişir.
 */
export const MERGE_DAYS_DEFAULT = 3;

/** Normalize edilmiş mağaza adı → kendi sınırı. */
const BY_STORE: Record<string, number> = {
  "derimod lefkosa": 4,
};

/** Herhangi bir mağazanın alabileceği en büyük sınır (şema üst sınırı). */
export const MERGE_DAYS_MAX = Math.max(MERGE_DAYS_DEFAULT, ...Object.values(BY_STORE));

function normalize(s: string): string {
  return s
    .replace(/İ/g, "i")
    .toLocaleLowerCase("tr")
    // "ı" bir harftir, aksan değil: NFD onu ayırmaz, a-z süzgeci silerdi
    // ("DERIMOD LEFKOSA" → "der mod lefkosa").
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function maxMergeDays(storeName: string | null | undefined): number {
  if (!storeName) return MERGE_DAYS_DEFAULT;
  return BY_STORE[normalize(storeName)] ?? MERGE_DAYS_DEFAULT;
}

/** "En fazla 3 gün birleştirilebilir." — mağazaya göre. */
export function mergeLimitMessage(max: number): string {
  return `En fazla ${max} gün birleştirilebilir.`;
}
