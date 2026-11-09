/**
 * Yazıyla tutar — Türk banka dekontları tutarı rakamla VE yazıyla basar
 * (Halkbank: "Y/(TL) UÇBİNYÜZ %00"). Rakam okuması kayarsa (02.10.2026:
 * Mavi Girne 01.10 dekontunda 3,100.00 → 3.168,68 okundu) yazıyla tutar
 * bağımsız ikinci kaynaktır. Saf fonksiyonlar, test edilebilir.
 */

const WORDS: Array<[string, number]> = [
  ["milyar", 1_000_000_000],
  ["milyon", 1_000_000],
  ["bin", 1000],
  ["yuz", 100],
  ["doksan", 90],
  ["seksen", 80],
  ["yetmis", 70],
  ["altmis", 60],
  ["elli", 50],
  ["kirk", 40],
  ["otuz", 30],
  ["yirmi", 20],
  ["on", 10],
  ["dokuz", 9],
  ["sekiz", 8],
  ["yedi", 7],
  ["alti", 6],
  ["bes", 5],
  ["dort", 4],
  ["uc", 3],
  ["iki", 2],
  ["bir", 1],
  ["sifir", 0],
];

/** Türkçe harfleri ASCII'ye indirger: "ÜÇBİNYÜZ" → "ucbinyuz". */
export function normalizeTr(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

/**
 * "ÜÇBİNYÜZ %00" → 3100 · "ONBEŞBİNALTIYÜZELLİ %50" → 15650.5 ·
 * "BİRMİLYONİKİYÜZBİN" → 1200000. Çözülemezse null.
 */
export function parseTurkishAmountWords(text: string | null | undefined): number | null {
  if (!text) return null;
  let s = normalizeTr(text);
  // Kuruş: "%00", "%50", "50 kurus", "virgul elli" gibi
  let kurus = 0;
  const pct = s.match(/%\s*(\d{1,2})/);
  if (pct) kurus = Number(pct[1]);
  const kr = s.match(/(\d{1,2})\s*kurus/);
  if (!pct && kr) kurus = Number(kr[1]);
  // "y/(tl)", "tl", "lira", "turk lirasi", "yalniz", "kurus", "sadece" gibi dolguları at
  s = s
    .replace(/y\s*\/\s*\(?\s*tl\s*\)?/g, " ")
    .replace(/\b(turk lirasi|lirasi|lira|tl|try|yalniz|sadece|kurus|krs)\b/g, " ")
    .replace(/%\s*\d{1,2}/g, " ")
    .replace(/\d{1,2}\s*kurus/g, " ");
  const letters = s.replace(/[^a-z]/g, "");
  if (!letters) return null;
  // Açgözlü, en uzun eşleşme ile parçala
  const tokens: number[] = [];
  let i = 0;
  while (i < letters.length) {
    let hit: [string, number] | null = null;
    for (const w of WORDS) {
      if (letters.startsWith(w[0], i) && (!hit || w[0].length > hit[0].length)) hit = w;
    }
    if (!hit) return null; // çözülemeyen parça — güvenme
    tokens.push(hit[1]);
    i += hit[0].length;
  }
  let total = 0;
  let current = 0;
  for (const v of tokens) {
    if (v < 100) current += v;
    else if (v === 100) current = (current || 1) * 100;
    else {
      total += (current || 1) * v;
      current = 0;
    }
  }
  return Math.round((total + current + kurus / 100) * 100) / 100;
}

/**
 * Basıldığı haliyle tutar metni → sayı. "3,100.00" (Amerikan: virgül binlik,
 * nokta kuruş) ve "3.100,00" (Türk) ayrımını ayraç desenine göre yapar.
 */
export function parsePrintedAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/[^\d.,]/g, "");
  if (!t) return null;
  let n: number | null = null;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) n = Number(t.replace(/,/g, ""));
  else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d+,\d{1,2}$/.test(t)) n = Number(t.replace(",", "."));
  else if (/^\d+\.\d{1,2}$/.test(t)) n = Number(t);
  else if (/^\d+$/.test(t)) n = Number(t);
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) n = Number(t.replace(/,/g, ""));
  return n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export type AmountReconciliation = {
  amount: number | null;
  source: "model" | "words" | "raw" | "total";
  words_value: number | null;
  raw_value: number | null;
  note: string | null;
};

/**
 * Modelin sayısal okuması ↔ yazıyla tutar ↔ basılı metin. Yazıyla tutar
 * bağımsız kaynaktır: varsa ve rakamdan 0,5 ₺'den fazla sapıyorsa o kazanır.
 * Yazı yoksa basılı metnin çözümü rakamla çelişiyorsa basılı metin kazanır
 * (biçim çevirme hatası: "3,100.00" → 3,1 gibi).
 */
export function reconcileReceiptAmount(input: {
  amount: number | null;
  amount_raw?: string | null;
  amount_in_words?: string | null;
  fee_amounts?: number[] | null;
  total_debited?: number | null;
  total_debited_raw?: string | null;
}): AmountReconciliation {
  const words_value = parseTurkishAmountWords(input.amount_in_words);
  const raw_value = parsePrintedAmount(input.amount_raw);
  const a = input.amount;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  // Ücretli dekont (TEB 07.11.2026: FAST 15,96 + FİV 0,48): yazıyla tutar ve
  // "Hesaptan toplam" transfer + ücretlerdir. Model 13.847,00'ı 13.047,00 okudu,
  // yazıyı da bozuk yazdı; ama basılı toplam 13.863,44 − ücretler = 13.847,00
  // denklemi tek başına doğruyu verir. Toplam: yazı çözülüyorsa yazı, yoksa
  // basılı toplam (metin, sonra sayı).
  const fees = (input.fee_amounts ?? []).filter((f) => Number.isFinite(f) && f >= 0);
  const feeSum = r2(fees.reduce((x, y) => x + y, 0));
  const printedTotal = parsePrintedAmount(input.total_debited_raw) ?? input.total_debited ?? null;
  if (fees.length > 0 && feeSum > 0) {
    const total =
      words_value != null && words_value > 0 && (printedTotal == null || Math.abs(words_value - printedTotal) <= 0.5)
        ? words_value
        : printedTotal;
    if (total != null && total > feeSum) {
      const transfer = r2(total - feeSum);
      if (a != null && Math.abs(a - transfer) <= 0.5) {
        return { amount: a, source: "model", words_value, raw_value, note: null };
      }
      // Rakam denklemi bozuyor. Yazı toplamı doğruluyorsa ya da rakam
      // yalnız bir hanede sapıyorsa (13.047 ↔ 13.847) denklem kazanır.
      const wordsBackTotal = words_value != null && Math.abs(words_value - total) <= 0.5;
      const sa = a == null ? "" : String(Math.round(a * 100)), sb = String(Math.round(transfer * 100));
      const oneDigit = sa.length === sb.length && Array.from(sa).filter((c, i) => c !== sb[i]).length === 1;
      if (a == null || wordsBackTotal || oneDigit) {
        return {
          amount: transfer,
          source: "total",
          words_value,
          raw_value,
          note: `Rakam ${a ?? "—"} denklemi bozdu: hesaptan toplam ${total} − ücretler ${feeSum} = ${transfer}${wordsBackTotal ? " (yazıyla tutar toplamı doğruluyor)" : ""}; denklem esas alındı`,
        };
      }
      return {
        amount: a,
        source: "model",
        words_value,
        raw_value,
        note: `UYARI: rakam ${a} ile hesaptan toplam ${total} − ücretler ${feeSum} = ${transfer} uyuşmuyor; rakam bırakıldı, elle kontrol`,
      };
    }
  }
  if (words_value != null && words_value > 0 && (a == null || Math.abs(a - words_value) > 0.5)) {
    return {
      amount: words_value,
      source: "words",
      words_value,
      raw_value,
      note: `Rakam ${a ?? "—"} yazıyla tutarla (${input.amount_in_words}) çelişti; yazı esas alındı: ${words_value}`,
    };
  }
  if (words_value == null && raw_value != null && raw_value > 0 && (a == null || Math.abs(a - raw_value) > 0.5)) {
    return {
      amount: raw_value,
      source: "raw",
      words_value,
      raw_value,
      note: `Rakam ${a ?? "—"} basılı metinle ("${input.amount_raw}") çelişti; basılı metin esas alındı: ${raw_value}`,
    };
  }
  return { amount: a, source: "model", words_value, raw_value, note: null };
}
