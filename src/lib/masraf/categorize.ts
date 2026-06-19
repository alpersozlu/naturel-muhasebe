/**
 * Masraf kategorize motoru — kasadan çıkan (Dosya 1) ve faturalı/kart (Dosya 2)
 * masraf açıklamalarını hedef kategorilere eşleştirir.
 *
 * Kategori sözlüğü mutabakatı: docs/MASRAF-MUHASEBE-PLANI.md
 * Kurallar 2026-06-19'da Alper ile netleştirildi.
 */

export type MasrafKategori =
  | "ISCI" // işçi parası, deneme personeli
  | "YEMEK" // yemek, su, kahve
  | "TERZI" // terzi + tamir
  | "KIRTASIYE"
  | "MARKET" // özel: ÷7 sonra ½ temizlik + ½ yemek (dağıtımda işlenir)
  | "MAZOT" // benzin + mazot (Dosya 3 OFİS/mazot)
  | "SEYAHAT" // taksi + hotel
  | "KIRA" // sadece Güzelyurt: orange mall + ortak alan
  | "POS" // otomatik %5 (kategorize edilmez, dağıtımda üretilir)
  | "DIGER" // camcı, cms, bilişim, internet, elektrik(küçük), bağış, dekorasyon...
  | "DEFOLU" // İndirim Kontrol push (kategorize edilmez)
  | "IGNORE"; // pazar — sistemde yok sayılır (maaşa dahil)

export const KATEGORI_LABEL: Record<MasrafKategori, string> = {
  ISCI: "İşçi",
  YEMEK: "Yemek",
  TERZI: "Terzi/Tamir",
  KIRTASIYE: "Kırtasiye",
  MARKET: "Market (→ ½ temizlik + ½ yemek)",
  MAZOT: "Mazot/Benzin",
  SEYAHAT: "Seyahat",
  KIRA: "Kira (Güzelyurt)",
  POS: "POS Gideri",
  DIGER: "Diğer Giderler",
  DEFOLU: "Defolu",
  IGNORE: "Yok sayılır (Pazar)",
};

/** Manuel kategoriler — yüklemeden gelmez, kullanıcı girer (referans). */
export const MANUEL_KATEGORILER = [
  "Çalışma Ücreti",
  "Elektrik (ana)",
  "Telefon/İnternet (ana)",
  "Kargo",
  "Banka Masrafı",
  "Muhasebe",
  "Sigorta",
  "Diğer mağaza kiraları",
] as const;

// Anahtar kelime → kategori. Sıra önemli: ÖZEL/spesifik kurallar önce gelir,
// çünkü ilk eşleşen kazanır (örn "pazar" IGNORE, "market" MARKET).
// Tümü normalize edilmiş (lowercase, türkçe i) metinde aranır.
const RULES: { kw: string[]; cat: MasrafKategori }[] = [
  // PAZAR → yok say (maaşa dahil) — "pazar parasi" dahil
  { kw: ["pazar"], cat: "IGNORE" },
  // KİRA — orange mall / ortak alan (sadece Güzelyurt; mağaza ataması ayrı)
  { kw: ["orange mall", "ortak alan", "ciro kira", "kira odeme"], cat: "KIRA" },
  // MARKET → özel dağıtım
  { kw: ["market"], cat: "MARKET" },
  // MAZOT / benzin
  { kw: ["mazot", "benzin"], cat: "MAZOT" },
  // SEYAHAT — taksi, otel/hotel
  { kw: ["taksi", "hotel", "otel", "konaklama"], cat: "SEYAHAT" },
  // TERZİ = tamir
  { kw: ["terzi", "tamir", "lastik"], cat: "TERZI" },
  // KIRTASİYE
  { kw: ["kirtasiye", "kırtasiye", "koli band", "hafiza kart", "hafıza kart", "toner", "kartus dolum"], cat: "KIRTASIYE" },
  // İŞÇİ — günlük/geçici işçi, deneme personeli (maaşlı personelden ayrı)
  { kw: ["isci", "işçi", "deneme personel", "yevmiye"], cat: "ISCI" },
  // YEMEK — yemek, su, kahve
  { kw: ["yemek", "su", "damacana", "kahve", "baklava"], cat: "YEMEK" },
  // Geri kalan her şey DİĞER GİDERLER (camcı, cms, bilişim, internet,
  // elektrik/klima/jeneratör/tesisat küçük işler, bağış, dekorasyon, raf, boya,
  // perde, belediye, vergi, aidat, mezarcı, ceza, alüminyum...)
];

function normalize(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anahtar kelimeyi metinde KELİME SINIRINDA arar (substring değil).
 * Aksi halde "su" → "super", "isci" → "iscilik" gibi yanlış eşleşmeler olur.
 * Çok kelimeli keyword'ler ("orange mall") yine bütün olarak aranır.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const k = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \p{L}\p{N} = harf/rakam (Türkçe dahil). Keyword'ün iki yanı harf/rakam olmamalı.
  return new RegExp(`(^|[^\\p{L}\\p{N}])${k}([^\\p{L}\\p{N}]|$)`, "u").test(text);
}

export type CategorizeResult = {
  category: MasrafKategori;
  /** true ise kullanıcı gözden geçirmeli (DİĞER'e düşen = belirsiz). */
  needsReview: boolean;
  /** eşleşen kural anahtarı (audit/şeffaflık). */
  matched: string | null;
};

/**
 * Bir masraf açıklamasını kategoriye eşleştirir.
 * Hiçbir spesifik kural eşleşmezse → DİĞER GİDERLER + needsReview
 * (kullanıcı "doğru mu?" diye bakabilsin diye işaretlenir).
 */
export function categorizeMasraf(rawDescription: string): CategorizeResult {
  const n = normalize(rawDescription);
  if (!n || n === "-") {
    return { category: "DIGER", needsReview: true, matched: null };
  }
  for (const rule of RULES) {
    const hit = rule.kw.find((k) => matchesKeyword(n, k));
    if (hit) {
      return { category: rule.cat, needsReview: false, matched: hit };
    }
  }
  // Eşleşmeyen → DİĞER (mutabakat: geri kalan her şey DİĞER), ama gözden geçir.
  return { category: "DIGER", needsReview: true, matched: null };
}
