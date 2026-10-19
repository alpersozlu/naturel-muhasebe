/**
 * MASRAF MARKA REGİSTRY (Faz 6, Faz 7'de satır düzeni sahibinin Excel'ine göre) — tek kaynak.
 *
 * Masraf muhasebe motoru iki markayı destekler: Mavi (4 mağaza) ve Derimod (3 mağaza).
 * Şirket faturaları (kart Excel'i ya da sahibinin fatura fotoğrafları) her iki markayı
 * kapsar: aylık kategori toplamı ÷7 (toplam mağaza) → her mağazaya eşit pay.
 * "Mavi Masraflar" çıktısı 4 Mavi payını, "Derimod Masraflar" çıktısı 3 Derimod payını gösterir.
 *
 * Bu dosya pure data — hem server (dağıtım/rapor/Excel) hem client (UI) import eder.
 * Mağaza kodları burada TANIMLI (Store tablosunda saklanmaz; ad/şehirden eşleşir).
 * Kategori sözlüğü + kurallar: docs/MASRAF-MUHASEBE-PLANI.md
 *
 * SATIR DÜZENİ = sahibinin "MAVI MASRAFLAR 2026.xlsx" dosyası (19.10.2026):
 *   KİRA → Kira, Kira (stopaj/KDV)
 *   PERSONEL → Çalışma Ücreti, Yemek, SSK, Yol, Prim, Personel stopajı, Tazminat, Mesai
 *   DİĞER GİDERLER → Muhasebe, Terzi, Telefon/İnternet, POS gideri, Kırtasiye, Temizlik,
 *                    Seyahat, Kargo, Elektrik, Banka, Sigorta, Diğer, Defolu
 *   OFİS → Kira, Maaş, SSK, Diğer, Mazot, Sigorta
 */

export type MasrafBrandKey = "mavi" | "derimod";

export type BrandStore = {
  /** Çıktı/DEFOLU kodu (Mavi: 9400-9403 SAP; Derimod: S01-S03 NEBIM) */
  code: string;
  /** Görünen ad (sütun başlığı) */
  label: string;
  /** Store.name / city içinde aranan ipuçları (normalize: lowercase, tr i→i) */
  match: string[];
};

export type MasrafGroupKey = "KIRA" | "PERSONEL" | "DIGER" | "OFIS";

export const MASRAF_GROUPS: { key: MasrafGroupKey; label: string }[] = [
  { key: "KIRA", label: "KİRA" },
  { key: "PERSONEL", label: "PERSONEL" },
  { key: "DIGER", label: "DİĞER GİDERLER" },
  { key: "OFIS", label: "OFİS" },
];

export type MasrafRow = {
  key: string;
  label: string;
  group: MasrafGroupKey;
  /** true = sistemin otomatik kaynakları var (fatura/kasa/POS/defolu/bordro); false = yalnız elle */
  auto: boolean;
  note?: string;
};

export type MasrafBrand = {
  key: MasrafBrandKey;
  /** DB Brand.name (sorgu filtresi) */
  brandName: string;
  /** Çıktı başlığı / Excel sayfa adı */
  title: string;
  /** Excel dosya adı öneki */
  fileTag: string;
  stores: BrandStore[];
  /** KİRA (kart/fotoğraf: orange mall + ortak alan) tüm tutarın yazıldığı tek mağaza kodu; null ise KİRA yalnız elle */
  kiraStoreCode: string | null;
  rows: MasrafRow[];
};

/** Satır sırasını markaya göre kur (KİRA ve DEFOLU marka davranışı farklı). */
function buildRows(opts: { kiraAuto: boolean; kiraNote: string; defoluAuto: boolean; defoluNote: string }): MasrafRow[] {
  return [
    // ── KİRA ───────────────────────────────────────────────────────────────
    { key: "KIRA", label: "Kira", group: "KIRA", auto: opts.kiraAuto, note: opts.kiraNote },
    { key: "KIRA_STOPAJ", label: "Kira (Stopaj / KDV)", group: "KIRA", auto: false },
    // ── PERSONEL ───────────────────────────────────────────────────────────
    { key: "CALISMA_UCRETI", label: "Çalışma Ücreti", group: "PERSONEL", auto: true, note: "bordro baz maaş + kasadan işçi parası" },
    { key: "YEMEK", label: "Yemek", group: "PERSONEL", auto: true, note: "yemek + su + market'in yarısı" },
    { key: "SSK", label: "SSK", group: "PERSONEL", auto: false },
    { key: "YOL", label: "Yol", group: "PERSONEL", auto: false },
    { key: "PRIM", label: "Prim", group: "PERSONEL", auto: true, note: "bordro komisyon + primler (top seller, giysi, parfüm, ek prim)" },
    { key: "PERSONEL_STOPAJ", label: "Personel Stopajı (var ise)", group: "PERSONEL", auto: false },
    { key: "TAZMINAT", label: "Tazminat", group: "PERSONEL", auto: true, note: "bordro izin / çıkış ödemesi; elle de girilir" },
    { key: "MESAI", label: "Mesai", group: "PERSONEL", auto: true, note: "bordro ek mesai ücreti" },
    // ── DİĞER GİDERLER ─────────────────────────────────────────────────────
    { key: "MUHASEBE", label: "Muhasebe", group: "DIGER", auto: true },
    { key: "TERZI", label: "Terzi", group: "DIGER", auto: true, note: "terzi + tamir" },
    { key: "TELEFON_INTERNET", label: "Telefon / İnternet", group: "DIGER", auto: true },
    { key: "POS", label: "POS Gideri", group: "DIGER", auto: true, note: "aylık Visa (kredi kartı) toplamının %5'i" },
    { key: "KIRTASIYE", label: "Kırtasiye", group: "DIGER", auto: true },
    { key: "TEMIZLIK", label: "Temizlik", group: "DIGER", auto: true, note: "temizlik + market'in yarısı" },
    { key: "SEYAHAT", label: "Seyahat Gideri", group: "DIGER", auto: true },
    { key: "KARGO", label: "Kargo", group: "DIGER", auto: true },
    { key: "ELEKTRIK", label: "Elektrik", group: "DIGER", auto: true, note: "ana fatura; küçük elektrik işleri Diğer'de" },
    { key: "BANKA", label: "Banka Masrafı", group: "DIGER", auto: true },
    { key: "SIGORTA", label: "Sigorta Giderleri", group: "DIGER", auto: true },
    { key: "DIGER", label: "Diğer Giderler (camcı, cms, bilgisayar…)", group: "DIGER", auto: true, note: "kategorisi bulunamayan her şey" },
    { key: "DEFOLU", label: "Defolu", group: "DIGER", auto: opts.defoluAuto, note: opts.defoluNote },
    // ── OFİS ───────────────────────────────────────────────────────────────
    { key: "OFIS_KIRA", label: "Kira", group: "OFIS", auto: false },
    { key: "OFIS_MAAS", label: "Maaş", group: "OFIS", auto: false },
    { key: "OFIS_SSK", label: "SSK", group: "OFIS", auto: false },
    { key: "OFIS_DIGER", label: "Diğer Giderler", group: "OFIS", auto: false },
    { key: "MAZOT", label: "Mazot", group: "OFIS", auto: true, note: "benzin / mazot (÷7)" },
    { key: "OFIS_SIGORTA", label: "Sigorta", group: "OFIS", auto: false },
  ];
}

/** Masraf kategorisi (categorize.ts) → tablo satırı. Burada olmayan kategori kendi adıyla satırdır. */
export const KATEGORI_TO_ROW: Record<string, string> = {
  ISCI: "CALISMA_UCRETI",
};
export function rowKeyOf(category: string): string {
  return KATEGORI_TO_ROW[category] ?? category;
}

export const MASRAF_BRANDS: Record<MasrafBrandKey, MasrafBrand> = {
  mavi: {
    key: "mavi",
    brandName: "Mavi Jeans",
    title: "Mavi Masraflar",
    fileTag: "Mavi_Masraflar",
    stores: [
      { code: "9400", label: "Lefkoşa", match: ["lefko"] },
      { code: "9401", label: "Girne", match: ["girne"] },
      { code: "9402", label: "Mağusa", match: ["magusa", "mağusa"] },
      { code: "9403", label: "Güzelyurt", match: ["guzelyurt", "güzelyurt"] },
    ],
    kiraStoreCode: "9403", // kart/fotoğraf kirası (orange mall + ortak alan) Güzelyurt'a; diğer mağazalar elle
    rows: buildRows({
      kiraAuto: true,
      kiraNote: "Güzelyurt: Orange Mall + ortak alan otomatik; diğer mağazalar elle",
      defoluAuto: true,
      defoluNote: "İndirim Kontrol → otomatik push",
    }),
  },
  derimod: {
    key: "derimod",
    brandName: "DERIMOD",
    title: "Derimod Masraflar",
    fileTag: "Derimod_Masraflar",
    // NEBIM mağaza kodları (S01 Lefkoşa / S02 Mağusa / S03 Girne).
    stores: [
      { code: "S01", label: "Lefkoşa", match: ["lefko"] },
      { code: "S03", label: "Girne", match: ["girne"] },
      { code: "S02", label: "Mağusa", match: ["magusa", "mağusa"] },
    ],
    kiraStoreCode: null, // Derimod kira: elle
    rows: buildRows({
      kiraAuto: false,
      kiraNote: "elle girilir",
      defoluAuto: false,
      defoluNote: "İndirim Kontrol Mavi'ye özel — gerekirse açılır",
    }),
  },
};

export const MASRAF_BRAND_KEYS = Object.keys(MASRAF_BRANDS) as MasrafBrandKey[];

export function getMasrafBrand(key: string): MasrafBrand {
  const b = MASRAF_BRANDS[key as MasrafBrandKey];
  if (!b) throw new Error(`Bilinmeyen masraf markası: ${key}`);
  return b;
}

/** Tüm markaların kod→marka eşlemesi (DEFOLU route global çözümleme için). */
export const ALL_STORE_CODES: Record<string, MasrafBrandKey> = Object.fromEntries(
  MASRAF_BRAND_KEYS.flatMap((k) => MASRAF_BRANDS[k].stores.map((s) => [s.code, k] as const))
);

function normalize(s: string): string {
  return s.toLocaleLowerCase("tr").replace(/ı/g, "i");
}

/** Bir marka içinde mağaza adından/şehrinden kodu çözer (yoksa null). */
export function brandCodeFromName(brand: MasrafBrand, name: string): string | null {
  const hay = normalize(name);
  const hit = brand.stores.find((s) => s.match.some((m) => hay.includes(normalize(m))));
  return hit ? hit.code : null;
}
