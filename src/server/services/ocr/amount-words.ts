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
  source: "model" | "words" | "raw";
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
}): AmountReconciliation {
  const words_value = parseTurkishAmountWords(input.amount_in_words);
  const raw_value = parsePrintedAmount(input.amount_raw);
  const a = input.amount;
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
