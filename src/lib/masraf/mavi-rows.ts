/**
 * MAVI MASRAF ÇIKTISI — satır sırası (Faz 4)
 *
 * "Mavi Masraflar" raporunun (Dosya 3 = MAVI 2025 MASRAFLAR@.xlsx) satır düzeni.
 * Satır = kategori, sütun = ay × mağaza. Bu liste TEK KAYNAK: hem ekran tablosu
 * hem Excel export aynı sırayı/etiketleri kullanır (client + server ortak — pure data).
 *
 * `auto: true`  → sistem otomatik doldurur (faturalı dağıtım / kasa / POS).
 * `auto: false` → kullanıcı manuel girer; tabloda "manuel bekliyor" işaretlenir.
 *
 * Not: matris anahtarları `masrafMatrix` çıktısıyla bire bir eşleşmeli.
 * MARKET burada YOK — dağıtımda ½ TEMIZLIK + ½ YEMEK'e bölünür, kategori değil.
 * Kategori sözlüğü: docs/MASRAF-MUHASEBE-PLANI.md
 */

export type MaviRowDef = {
  /** matris anahtarı (auto satırlar) ya da manuel kategori anahtarı */
  key: string;
  label: string;
  /** true = sistem doldurur, false = manuel bekliyor */
  auto: boolean;
  /** opsiyonel açıklama (örn. Defolu için Faz 5 notu) */
  note?: string;
};

export const MAVI_ROW_ORDER: readonly MaviRowDef[] = [
  // ── Sistemin otomatik dolduracağı kategoriler ──────────────────────────
  { key: "ISCI", label: "İşçi", auto: true },
  { key: "YEMEK", label: "Yemek", auto: true },
  { key: "TEMIZLIK", label: "Temizlik", auto: true },
  { key: "TERZI", label: "Terzi / Tamir", auto: true },
  { key: "KIRTASIYE", label: "Kırtasiye", auto: true },
  { key: "MAZOT", label: "Mazot / Benzin", auto: true },
  { key: "SEYAHAT", label: "Seyahat", auto: true },
  { key: "KIRA", label: "Kira (Güzelyurt)", auto: true },
  { key: "DIGER", label: "Diğer Giderler", auto: true },
  { key: "POS", label: "POS Gideri (%5)", auto: true },
  // ── Kullanıcının manuel gireceği kategoriler (manuel bekliyor) ─────────
  { key: "CALISMA_UCRETI", label: "Çalışma Ücreti", auto: false, note: "maaş/SSK/yol/prim/mesai + pazar parası" },
  { key: "ELEKTRIK", label: "Elektrik (ana fatura)", auto: false, note: "kasadaki küçük elektrik DİĞER'e gider" },
  { key: "TELEFON_INTERNET", label: "Telefon / İnternet (ana)", auto: false, note: "karttaki bilişim DİĞER'e gider" },
  { key: "KARGO", label: "Kargo", auto: false },
  { key: "BANKA", label: "Banka Masrafı", auto: false },
  { key: "MUHASEBE", label: "Muhasebe", auto: false },
  { key: "SIGORTA", label: "Sigorta", auto: false },
  { key: "MAGAZA_KIRA", label: "Diğer Mağaza Kiraları", auto: false, note: "Güzelyurt hariç 3 Mavi + ortak giderler" },
  // DEFOLU: İndirim Kontrol programından otomatik push (Faz 5) — veri gelene dek boş görünür.
  { key: "DEFOLU", label: "Defolu", auto: true, note: "İndirim Kontrol → otomatik push" },
] as const;

/** Auto satır anahtarları seti (matris bu anahtarlarla gelir). */
export const MAVI_AUTO_KEYS = new Set(
  MAVI_ROW_ORDER.filter((r) => r.auto).map((r) => r.key)
);
