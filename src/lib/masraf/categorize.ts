/**
 * Masraf kategorize motoru — kasadan çıkan masraf (Expense / CashAdvance),
 * faturalı/kart Excel satırı (Dosya 2) ve sahibinin fatura fotoğrafları
 * (MasrafInvoice) için tek motor. Çıktı: "Mavi Masraflar" tablosunun satırı.
 *
 * Kategori sözlüğü mutabakatı: docs/MASRAF-MUHASEBE-PLANI.md
 * Kurallar 2026-06-19'da Alper ile netleştirildi; 19.10.2026'da fotoğraf
 * otomasyonuyla genişletildi (sahibi): yemek = yemek + market'in yarısı,
 * temizlik = temizlik + market'in yarısı, işçi parası → ÇALIŞMA ÜCRETİ,
 * kategorisi bulunamayan → DİĞER GİDERLER, POS gideri = Visa'nın %5'i.
 */

export type MasrafKategori =
  | "ISCI" // işçi parası, yevmiye, deneme personeli → ÇALIŞMA ÜCRETİ satırı
  | "YEMEK" // yemek, su, kahve
  | "TEMIZLIK" // temizlik malzemesi, cam temizliği (+ market'in yarısı)
  | "TERZI" // terzi + tamir (paça, ayakkabı tamiri, lastik…)
  | "KIRTASIYE"
  | "MARKET" // özel: ½ temizlik + ½ yemek (dağıtımda işlenir)
  | "MAZOT" // benzin + mazot (OFİS / mazot satırı)
  | "SEYAHAT" // taksi + hotel
  | "KIRA" // Güzelyurt: orange mall + ortak alan (kart) · mağaza kiraları elle
  | "ELEKTRIK" // ana elektrik faturası (KIB-TEK)
  | "TELEFON_INTERNET" // telefon / internet ana faturası
  | "KARGO"
  | "BANKA" // banka masrafı
  | "MUHASEBE"
  | "SIGORTA"
  | "POS" // otomatik %5 (kategorize edilmez, dağıtımda üretilir)
  | "DIGER" // camcı, cms, bilişim, küçük elektrik/tesisat, bağış, dekorasyon, boya…
  | "DEFOLU" // İndirim Kontrol push (kategorize edilmez)
  | "IGNORE"; // pazar / avans — masraf tablosunda yok sayılır

export const KATEGORI_LABEL: Record<MasrafKategori, string> = {
  ISCI: "İşçi parası (→ Çalışma Ücreti)",
  YEMEK: "Yemek",
  TEMIZLIK: "Temizlik",
  TERZI: "Terzi / Tamir",
  KIRTASIYE: "Kırtasiye",
  MARKET: "Market (→ ½ temizlik + ½ yemek)",
  MAZOT: "Mazot / Benzin (Ofis)",
  SEYAHAT: "Seyahat",
  KIRA: "Kira",
  ELEKTRIK: "Elektrik (ana fatura)",
  TELEFON_INTERNET: "Telefon / İnternet",
  KARGO: "Kargo",
  BANKA: "Banka Masrafı",
  MUHASEBE: "Muhasebe",
  SIGORTA: "Sigorta",
  POS: "POS Gideri",
  DIGER: "Diğer Giderler",
  DEFOLU: "Defolu",
  IGNORE: "Yok sayılır (pazar / avans)",
};

/** Kullanıcının seçebileceği kategoriler (POS ve DEFOLU üretilir, seçilmez). */
export const SELECTABLE_KATEGORILER: MasrafKategori[] = [
  "YEMEK",
  "TEMIZLIK",
  "MARKET",
  "ISCI",
  "TERZI",
  "KIRTASIYE",
  "MAZOT",
  "SEYAHAT",
  "KIRA",
  "ELEKTRIK",
  "TELEFON_INTERNET",
  "KARGO",
  "BANKA",
  "MUHASEBE",
  "SIGORTA",
  "DIGER",
  "IGNORE",
];

/** Manuel kategoriler — yüklemeden gelmez, kullanıcı girer (referans). */
export const MANUEL_KATEGORILER = [
  "SSK",
  "Yol",
  "Personel stopajı",
  "Tazminat",
  "Kira (stopaj/KDV)",
  "Diğer mağaza kiraları",
  "Ofis kalemleri",
] as const;

// Anahtar kelime → kategori. Sıra önemli: ÖZEL/spesifik kurallar önce gelir,
// çünkü ilk eşleşen kazanır (örn "pazar" IGNORE, "market" MARKET).
// Tümü normalize edilmiş (lowercase, türkçe i) metinde aranır.
const RULES: { kw: string[]; cat: MasrafKategori }[] = [
  // PAZAR → yok say (maaşa dahil) — "pazar parasi" dahil. Avans da masraf değil.
  { kw: ["pazar", "avans"], cat: "IGNORE" },
  // KİRA — orange mall / ortak alan (sadece Güzelyurt; mağaza ataması ayrı)
  { kw: ["orange mall", "ortak alan", "ciro kira", "kira odeme", "kira ödeme", "kira bedeli"], cat: "KIRA" },
  // MARKET → özel dağıtım
  { kw: ["market", "süpermarket", "supermarket"], cat: "MARKET" },
  // MAZOT / benzin
  { kw: ["mazot", "benzin", "akaryakit", "akaryakıt", "petrol", "yakit", "yakıt"], cat: "MAZOT" },
  // SEYAHAT — taksi, otel/hotel
  { kw: ["taksi", "hotel", "otel", "konaklama", "ucak", "uçak", "bilet"], cat: "SEYAHAT" },
  // ANA FATURALAR
  { kw: ["kib-tek", "kibtek", "kıb-tek", "elektrik faturasi", "elektrik faturası", "elektrik kurumu"], cat: "ELEKTRIK" },
  { kw: ["telefon", "internet", "kktcell", "turkcell", "telsim", "vodafone", "fibera", "multimax", "superonline", "hat ucreti", "hat ücreti"], cat: "TELEFON_INTERNET" },
  { kw: ["kargo", "kurye", "posta", "nakliye"], cat: "KARGO" },
  { kw: ["banka masraf", "havale ucreti", "havale ücreti", "komisyon", "hesap isletim", "hesap işletim"], cat: "BANKA" },
  { kw: ["muhasebe", "mali musavir", "mali müşavir", "denetim ucreti", "denetim ücreti"], cat: "MUHASEBE" },
  { kw: ["sigorta", "police", "poliçe"], cat: "SIGORTA" },
  // TEMİZLİK — cam temizliği, temizlik malzemesi, deterjan
  { kw: ["temizlik", "temizligi", "temizliği", "temizlige", "temizliğe", "deterjan", "cam silme", "hijyen", "wc", "tuvalet kagidi", "tuvalet kağıdı", "eldiven", "cop torbasi", "çöp torbası", "copluk", "çöp"], cat: "TEMIZLIK" },
  // TERZİ = tamir (paça, dikiş, ayakkabı tamiri, lastik)
  { kw: ["terzi", "tamir", "lastik", "paca", "paça", "dikis", "dikiş", "tadilat", "ayakkabici", "ayakkabıcı", "kundura"], cat: "TERZI" },
  // KIRTASİYE
  { kw: ["kirtasiye", "kırtasiye", "koli band", "hafiza kart", "hafıza kart", "toner", "kartus dolum", "kartuş dolum", "fotokopi", "zimba", "zımba", "epson", "a4", "etiket", "baski", "baskı", "flex"], cat: "KIRTASIYE" },
  // İŞÇİ — günlük/geçici işçi, deneme personeli (maaşlı personelden ayrı)
  { kw: ["isci", "işçi", "deneme personel", "yevmiye", "hamal", "gunluk eleman", "günlük eleman", "kisi parasi", "kişi parası", "personel odeme", "personel ödeme"], cat: "ISCI" },
  // YEMEK — yemek, su, kahve
  { kw: ["yemek", "su", "damacana", "kahve", "cay", "çay", "baklava", "doner", "döner", "restaurant", "restoran", "pizza", "kebap", "lokanta", "pide", "lahmacun", "tatli", "tatlı", "borek", "börek", "simit", "icecek", "içecek", "kola"], cat: "YEMEK" },
  // Geri kalan her şey DİĞER GİDERLER (camcı, cms, bilişim, internet,
  // elektrik/klima/jeneratör/tesisat küçük işler, bağış, dekorasyon, raf, boya,
  // perde, belediye, vergi, aidat, mezarcı, ceza, alüminyum...)
];

/**
 * Market zincirleri (KKTC) — satıcı adında geçerse MARKET kuralı (½ temizlik +
 * ½ yemek). Mağazalar temizlik malzemesini ve suyu çoğu zaman marketten alır.
 */
const MARKET_VENDORS = [
  "lemar", "kaya market", "starling", "metropol", "metroplus", "aytas", "aytaş", "oyak", "ordu pazar", "zop",
  "migros", "a101", "bim ", "sok market", "şok market", "erulku", "erülkü", "kolaylı", "kolayli", "kiler",
  "carrefour", "onur market", "tempo", "ozsoy", "özsoy", "alsancak market", "miller", "fresh market", "gross",
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
 * Bir masraf açıklamasını kategoriye eşleştirir (yalnız metin).
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

/** Satıcı adı bir market zinciri mi? */
export function isMarketVendor(vendor: string | null | undefined): boolean {
  if (!vendor) return false;
  const v = normalize(vendor);
  return MARKET_VENDORS.some((m) => v.includes(normalize(m)));
}

/**
 * Mağazanın (ya da OCR'ın) ExpenseCategory'si → masraf satırı. Belirsiz olanlar
 * (other/supplies/maintenance/marketing) null döner → metin kuralları karar verir.
 */
export const EXPENSE_CATEGORY_TO_MASRAF: Record<string, MasrafKategori | null> = {
  food: "YEMEK",
  water: "YEMEK", // damacana su → yemek (mutabakat)
  cleaning: "TEMIZLIK",
  stationery: "KIRTASIYE",
  tailor: "TERZI",
  labor: "ISCI",
  salary: "ISCI",
  electricity: "ELEKTRIK",
  internet: "TELEFON_INTERNET",
  rent: "KIRA",
  glazier: "DIGER", // camcı → DİĞER GİDERLER (CAMCI+CMS+…)
  marketing: "DIGER",
  bonus: "IGNORE", // avans
  other: null,
  supplies: null,
  maintenance: null,
};

/**
 * Bir masraf KAYDINI (kategori + satıcı + açıklama) masraf satırına eşler.
 * Öncelik:
 *  1. Satıcı market zinciriyse ya da açıklamada "market" geçiyorsa → MARKET
 *     (mağaza "temizlik" seçmiş olsa bile; sahibi: market ½ temizlik + ½ yemek).
 *  2. Açıklamada belirleyici kelime (işçi, pazar, kira, mazot, kargo…) varsa o.
 *  3. Mağazanın/OCR'ın kategorisi kesinse (yemek, temizlik, kırtasiye, terzi…) o.
 *  4. Satıcı adından kural (restoran → yemek, kırtasiye → kırtasiye…).
 *  5. Hiçbiri → DİĞER + gözden geçir.
 */
export function categorizeExpense(input: {
  category?: string | null;
  vendor?: string | null;
  description?: string | null;
}): CategorizeResult {
  const desc = input.description ?? "";
  const vendor = input.vendor ?? "";
  const mapped = input.category ? (EXPENSE_CATEGORY_TO_MASRAF[input.category] ?? null) : null;

  if (isMarketVendor(vendor) || matchesKeyword(normalize(desc), "market")) {
    return { category: "MARKET", needsReview: false, matched: "market" };
  }
  const byDesc = desc.trim() ? categorizeMasraf(desc) : null;
  // Açıklama kesin bir kategori verdiyse (DİĞER değil) o kazanır: "işçi yemek parası"
  // yemektir ama "2 işçi parası" işçidir — kural sırası (ISCI > YEMEK) bunu belirler;
  // mağaza "food" seçtiyse ve açıklama yemek/işçi karışıksa mağazanın seçimi esas.
  if (byDesc && !byDesc.needsReview) {
    if (mapped && mapped !== byDesc.category && (byDesc.category === "ISCI" || byDesc.category === "YEMEK") && (mapped === "ISCI" || mapped === "YEMEK")) {
      return { category: mapped, needsReview: false, matched: `kategori:${input.category}` };
    }
    return byDesc;
  }
  if (mapped) return { category: mapped, needsReview: false, matched: `kategori:${input.category}` };
  const byVendor = vendor.trim() ? categorizeMasraf(vendor) : null;
  if (byVendor && !byVendor.needsReview) return byVendor;
  return { category: "DIGER", needsReview: true, matched: null };
}
