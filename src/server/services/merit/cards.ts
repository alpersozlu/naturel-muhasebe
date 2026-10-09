/**
 * Merit personel kimlik kartları — ad normalizasyonu, fiş müşteri adı ↔ kart
 * adı benzerliği ve kart fotoğrafının OCR'ı.
 *
 * Kart (Merit Park / Merit Royal…): "PERSONEL KİMLİK KARTI", ad soyad,
 * "Sicil Numarası / ID No", "Kurum / Company", "Departman / Department",
 * "İşe Başladığı Tarih / Join Date". Mağaza fotoğrafı telefonla çeker; dosya
 * adı çoğu kez IMG_YYYYMMDD_HHMMSS (çekim günü) ya da kişinin adıdır.
 *
 * Eşleştirme NEBİM fişindeki müşteri adıyla yapılır (Merit indirimli fişlerde
 * müşteri adı her zaman dolu: 43/43, 09.10.2026). Türkçe harf, büyük/küçük,
 * bitişik yazım ("KEMALTEKELIOĞLU") ve ad/soyad sırası farkları tolere edilir.
 */
import { z } from "zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessImage } from "@/server/services/ocr/preprocess";

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Aksansız, büyük harf, tek boşluk. "Alİna  Nanaeva" → "ALINA NANAEVA" */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "");
  let out = "";
  for (const ch of lower) out += TR_MAP[ch] ?? ch;
  return out
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Levenshtein oranı 0..1 (1 = aynı). OCR'ın tek harf hataları için (KÖRÜKÇÜ ↔ KÖRÜKCİ). */
export function tokenRatio(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[m]! / Math.max(n, m);
}

const TOKEN_FUZZY_MIN = 0.75;

/**
 * 0..1 benzerlik. Önce tam eşitlik ve bitişik yazım (boşluksuz eşitlik),
 * sonra kelime eşleşmesi: her kelime için karşı taraftaki en iyi kelime
 * (tam = 1, Levenshtein oranı ≥ 0,75 ise o oran — OCR tek harf hatası).
 * Jaccard + soyadı bonusu + bitişik içerme. ≥ 0,8 "aynı kişi" (otomatik),
 * 0,4–0,8 "öneri", altı eşleşme yok.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = normalizeName(a);
  const B = normalizeName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const aj = A.replace(/ /g, "");
  const bj = B.replace(/ /g, "");
  if (aj === bj) return 0.98;
  const ta = A.split(" ").filter((w) => w.length > 1);
  const tb = B.split(" ").filter((w) => w.length > 1);
  if (ta.length === 0 || tb.length === 0) return 0;
  // her A kelimesi için B'deki en iyi karşılık (tam 1, yakın ≥0,75 kendi oranı)
  let inter = 0;
  let matchedTokens = 0;
  const used = new Set<number>();
  for (const w of ta) {
    let best = 0;
    let bestJ = -1;
    tb.forEach((v, j) => {
      if (used.has(j)) return;
      const r = w === v ? 1 : tokenRatio(w, v);
      if (r > best) {
        best = r;
        bestJ = j;
      }
    });
    if (best >= TOKEN_FUZZY_MIN && bestJ >= 0) {
      inter += best;
      matchedTokens += 1;
      used.add(bestJ);
    }
  }
  const union = ta.length + tb.length - matchedTokens;
  const jaccard = inter / union;
  // soyadı (son kelime) eşleşiyorsa ek güven
  const la = ta.at(-1)!;
  const lb = tb.at(-1)!;
  const surname = la === lb ? 0.15 : tokenRatio(la, lb) >= TOKEN_FUZZY_MIN ? 0.1 : 0;
  // bitişik gövde içerme: "KEMALTEKELIOGLU" ⊃ "TEKELIOGLU"
  const contains = aj.includes(bj) || bj.includes(aj) ? 0.6 : 0;
  // iki kelime (ad + soyad) eşleşti: aynı kişi — tam eşleşmede 0,85, yakın eşleşmede biraz altı
  const twoTokens = matchedTokens >= 2 ? 0.85 * (inter / matchedTokens) : 0;
  // ad aynı, soyadı yarı yarıya benziyor (fişte yanlış yazılmış soyadı): yalnız ÖNERİ
  const firstName = ta[0] === tb[0] && tokenRatio(la, lb) >= 0.5 ? 0.45 : 0;
  return Math.min(1, Math.max(jaccard + surname, contains, twoTokens, firstName));
}

/** IMG_20260909_192414.jpg → 2026-09-09; başka ad → null */
export function photoDateFromName(name: string | null | undefined): string | null {
  const m = name?.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const mm = Number(mo);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${mo}-${d}`;
}

export const meritCardOcrSchema = z.object({
  is_card: z.boolean(),
  rejection_reason: z.string().nullable(),
  hotel: z.string().nullable(),
  full_name: z.string().nullable(),
  id_no: z.string().nullable(),
  company: z.string().nullable(),
  department: z.string().nullable(),
  join_date: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable().optional().default(null),
});
export type MeritCardOcr = z.infer<typeof meritCardOcrSchema>;

const SYSTEM = `Sen bir otel personel kimlik kartı okuyucususun. Fotoğrafta Kuzey Kıbrıs'taki Merit otellerinin (Merit Park, Merit Royal, Merit Crystal Cove, Merit Cyprus Gardens…) "PERSONEL KİMLİK KARTI / PERSONAL ID CARD" kartı olabilir. Yalnız JSON döndür, başka metin yazma.`;

const USER = `Bu fotoğrafı oku ve şu JSON'u döndür:
{
  "is_card": true/false,            // fotoğrafta bir otel PERSONEL kimlik kartı var mı (kimlik kartı, pasaport, başka belge → false)
  "rejection_reason": null | "neden",
  "hotel": "Merit" | null,          // kart Merit grubuna mı ait (logo / Merit yazısı)
  "full_name": "AD SOYAD" | null,   // kartta BÜYÜK harfle basılı ad soyad, aynen
  "id_no": "1453" | null,           // Sicil Numarası / ID No
  "company": "Merit Park" | null,   // Kurum / Company
  "department": "Live Game" | null, // Departman / Department
  "join_date": "15.09.2014" | null, // İşe Başladığı Tarih / Join Date, basıldığı gibi
  "confidence": 0.0-1.0             // okuduğun ada güvenin
}
Kart yoksa veya ad okunamıyorsa ilgili alanları null bırak; uydurma.`;

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  return s >= 0 && e > s ? raw.slice(s, e + 1) : raw;
}

/** Kart fotoğrafını okur. Hata fırlatmaz; okunamazsa is_card=false + neden. */
export async function ocrMeritCard(buffer: Buffer, mimeType: string): Promise<MeritCardOcr> {
  const pre = await preprocessImage(buffer, mimeType);
  const client = getAnthropic();
  const res = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: pre.mediaType, data: pre.buffer.toString("base64") } },
          { type: "text", text: USER },
        ],
      },
    ],
  });
  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    return { is_card: false, rejection_reason: `Model JSON döndürmedi: ${text.slice(0, 120)}`, hotel: null, full_name: null, id_no: null, company: null, department: null, join_date: null, confidence: null };
  }
  const parsed = meritCardOcrSchema.safeParse(raw);
  if (!parsed.success) {
    return { is_card: false, rejection_reason: `Model çıktısı şemaya uymadı: ${parsed.error.issues[0]?.message ?? ""}`, hotel: null, full_name: null, id_no: null, company: null, department: null, join_date: null, confidence: null };
  }
  return parsed.data;
}
