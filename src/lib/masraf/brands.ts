/**
 * MASRAF MARKA REGİSTRY (Faz 6) — tek kaynak.
 *
 * Masraf muhasebe motoru iki markayı destekler: Mavi (4 mağaza) ve Derimod (3 mağaza).
 * Şirket kartı "Faturalı Masraflar" her iki markayı kapsar: aylık kategori toplamı
 * ÷7 (toplam mağaza) → her mağazaya eşit pay. "Mavi Masraflar" çıktısı 4 Mavi payını,
 * "Derimod Masraflar" çıktısı 3 Derimod payını (3/7) gösterir.
 *
 * Bu dosya pure data — hem server (dağıtım/rapor/Excel) hem client (UI) import eder.
 * Mağaza kodları burada TANIMLI (Store tablosunda saklanmaz; ad/şehirden eşleşir).
 * Kategori sözlüğü + kurallar: docs/MASRAF-MUHASEBE-PLANI.md
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

export type MasrafRow = {
  key: string;
  label: string;
  /** true = sistem doldurur (faturalı/kasa/POS/defolu), false = manuel bekliyor */
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
  /** KİRA tüm tutarın yazıldığı tek mağaza kodu; null ise KİRA manuel */
  kiraStoreCode: string | null;
  rows: MasrafRow[];
};

/** Satır sırasını markaya göre kur (KİRA ve DEFOLU marka davranışı farklı). */
function buildRows(opts: {
  kiraAuto: boolean;
  kiraLabel: string;
  defoluAuto: boolean;
  defoluNote: string;
}): MasrafRow[] {
  return [
    // ── Sistemin otomatik dolduracağı kategoriler ──────────────────────────
    { key: "ISCI", label: "İşçi", auto: true },
    { key: "YEMEK", label: "Yemek", auto: true },
    { key: "TEMIZLIK", label: "Temizlik", auto: true },
    { key: "TERZI", label: "Terzi / Tamir", auto: true },
    { key: "KIRTASIYE", label: "Kırtasiye", auto: true },
    { key: "MAZOT", label: "Mazot / Benzin", auto: true },
    { key: "SEYAHAT", label: "Seyahat", auto: true },
    { key: "KIRA", label: opts.kiraLabel, auto: opts.kiraAuto, note: opts.kiraAuto ? undefined : "marka kira düzeni manuel" },
    { key: "DIGER", label: "Diğer Giderler", auto: true },
    { key: "POS", label: "POS Gideri (%5)", auto: true },
    { key: "DEFOLU", label: "Defolu", auto: opts.defoluAuto, note: opts.defoluNote },
    // ── Kullanıcının manuel gireceği kategoriler (manuel bekliyor) ─────────
    { key: "CALISMA_UCRETI", label: "Çalışma Ücreti", auto: false, note: "maaş/SSK/yol/prim/mesai + pazar parası" },
    { key: "ELEKTRIK", label: "Elektrik (ana fatura)", auto: false, note: "kasadaki küçük elektrik DİĞER'e gider" },
    { key: "TELEFON_INTERNET", label: "Telefon / İnternet (ana)", auto: false, note: "karttaki bilişim DİĞER'e gider" },
    { key: "KARGO", label: "Kargo", auto: false },
    { key: "BANKA", label: "Banka Masrafı", auto: false },
    { key: "MUHASEBE", label: "Muhasebe", auto: false },
    { key: "SIGORTA", label: "Sigorta", auto: false },
    { key: "MAGAZA_KIRA", label: "Diğer Mağaza Kiraları", auto: false, note: "ortak giderler" },
  ];
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
    kiraStoreCode: "9403", // tüm kira Güzelyurt'a (orange mall + ortak alan)
    rows: buildRows({
      kiraAuto: true,
      kiraLabel: "Kira (Güzelyurt)",
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
    // Muhasebe farklı kod kullanıyorsa burada değiştir — tek kaynak.
    stores: [
      { code: "S01", label: "Lefkoşa", match: ["lefko"] },
      { code: "S03", label: "Girne", match: ["girne"] },
      { code: "S02", label: "Mağusa", match: ["magusa", "mağusa"] },
    ],
    kiraStoreCode: null, // Derimod kira: manuel bekliyor (mutabakat — Faz 6)
    rows: buildRows({
      kiraAuto: false,
      kiraLabel: "Kira",
      defoluAuto: false, // İndirim Kontrol Mavi'ye özel; Derimod defolu gelirse auto'ya çevir
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
  MASRAF_BRAND_KEYS.flatMap((k) =>
    MASRAF_BRANDS[k].stores.map((s) => [s.code, k] as const)
  )
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
