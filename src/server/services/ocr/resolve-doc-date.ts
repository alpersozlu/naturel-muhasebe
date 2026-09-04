import "server-only";

/**
 * Belge tarihini modelin ISO yorumuna GÜVENMEDEN çözer.
 *
 * Neden: OCR modeli "24,8,26" (el yazısı) ya da "24/08/26" (Yapı Kredi) gibi
 * yazımları bazen 2024-08-24 diye yorumluyor — ilk grubu yıl sanıyor ya da
 * iki haneli yılı yanlış tamamlıyor. Belgedeki metin ise nettir: Türkiye'de
 * tarih GÜN-AY-YIL yazılır. Ham metni alıp bu sırayla çözersek modelin
 * yorumuna bağımlı kalmayız.
 */

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5,
  haziran: 6, temmuz: 7, agustos: 8, ağustos: 8, eylul: 9, eylül: 9,
  ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function toIso(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const yyyy = y < 100 ? 2000 + y : y;
  // Geçerli bir takvim günü mü? (31 Şubat gibi)
  const dt = new Date(Date.UTC(yyyy, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${yyyy}-${pad(m)}-${pad(d)}`;
}

/**
 * Belgeden okunan ham tarih metnini GG-AA-YY(YY) sırasıyla çözer.
 * Kabul edilen ayraçlar: . , / - boşluk. "24 Ağustos 2026" da çözülür.
 * Çözülemezse null.
 */
export function parseTurkishDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLocaleLowerCase("tr");

  // Model zaten ISO verdiyse (YYYY-MM-DD) önce onu tanı — aksi halde aşağıdaki
  // GG-AA-YY deseni "2026-08-24"ün içinden "26-08-24"ü yakalayıp 2024 üretir.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return toIso(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  // 24.08.2026 · 24/8/26 · 24,8,26 · 24-08-26 · 24 08 2026
  // (?<!\d) / (?!\d): daha uzun bir sayının ortasından parça yakalama.
  const num = s.match(
    /(?<!\d)(\d{1,2})\s*[.,/\-\s]\s*(\d{1,2})\s*[.,/\-\s]\s*(\d{2,4})(?!\d)/
  );
  if (num) {
    const [, d, m, y] = num;
    return toIso(Number(d), Number(m), Number(y));
  }

  // 24 ağustos 2026 · 24 ağu 26
  const named = s.match(/(\d{1,2})\s+([a-zçğıöşü]+)\.?\s+(\d{2,4})/);
  if (named) {
    const [, d, mon, y] = named;
    const key = Object.keys(TR_MONTHS).find((k) => k.startsWith(mon.slice(0, 3)));
    if (key) return toIso(Number(d), TR_MONTHS[key]!, Number(y));
  }

  return null;
}

/**
 * Gün ↔ iki-haneli-yıl takası: 2024-08-26 → 2026-08-24. Model GG/AA/YY'yi
 * YY/AA/GG diye okuduğunda bu geri alır.
 */
export function swapDayAndTwoDigitYear(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, year, month, day] = m as unknown as [string, string, string, string];
  if (!year.startsWith("20")) return null;
  return toIso(Number(year.slice(2)), Number(month), Number(`20${day}`));
}

export type DocDateResolution = {
  /** Kullanılacak tarih — hedefle eşleşen aday, yoksa belgenin kendi tarihi */
  iso: string | null;
  /** Hedef günle eşleşti mi */
  matches: boolean;
  /** Hangi yol eşleşmeyi verdi (log/teşhis için) */
  via: "raw" | "model" | "swap" | "year" | null;
};

/**
 * Adayları sırayla hedef günle karşılaştırır:
 *   1. Ham metnin GG-AA-YY çözümü  (en güvenilir — belgenin kendisi)
 *   2. Modelin ISO yorumu
 *   3. Modelin ISO'sunun gün/yıl takası
 *   4. Gün ve ay tutuyor, yalnız YIL farklı → kabul. Yıl hanesi soluk baskıda
 *      en sık yanlış okunan rakamdır (Girne 25/08/2026 → "2023", Z raporu
 *      → "2025"); kullanıcı günü zaten seçmiş ve belgedeki gün-ay onunla
 *      birebir aynıyken bunu reddetmek yalnız yeniden yükleme döngüsü
 *      üretiyor. Aynı gün-ayın başka bir yılına ait belge yüklenmesi ise
 *      pratikte görülmedi; olursa tutarlar mutabakatta zaten tutmaz.
 * Hiçbiri tutmuyorsa belgenin "kendi" tarihi olarak ham çözümü (yoksa
 * modelinkini) döndürür ki hata mesajı doğru rakamı göstersin.
 */
export function resolveDocumentDate(opts: {
  raw: string | null | undefined;
  modelIso: string | null | undefined;
  expectedIso: string | null;
}): DocDateResolution {
  const rawIso = parseTurkishDate(opts.raw);
  const modelIso = opts.modelIso ?? null;
  const swapped = modelIso ? swapDayAndTwoDigitYear(modelIso) : null;

  if (opts.expectedIso) {
    if (rawIso === opts.expectedIso) return { iso: rawIso, matches: true, via: "raw" };
    if (modelIso === opts.expectedIso) return { iso: modelIso, matches: true, via: "model" };
    if (swapped === opts.expectedIso) return { iso: swapped, matches: true, via: "swap" };
    const monthDay = opts.expectedIso.slice(4); // "-08-25"
    if (rawIso?.slice(4) === monthDay || modelIso?.slice(4) === monthDay) {
      return { iso: opts.expectedIso, matches: true, via: "year" };
    }
  }
  return { iso: rawIso ?? modelIso, matches: false, via: null };
}
