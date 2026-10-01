/**
 * Garanti "TGB Yeni Maaş Dosyası" sabitleri — Naturel Ticaret'in maaş
 * ödemesinde kullandığı kurum tanımı (Mert'in devir paketi, "Talimat
 * Formatı" sayfası). Dosyanın B1–B9 hücreleri bankaya bu değerlerle gider.
 *
 * Değişirse yalnız burası değişir. Çalışan hesap bilgileri (şube, hesap,
 * IBAN) buraya yazılmaz; PayrollEmployee kaydında tutulur.
 */
export const GARANTI_TALIMAT = {
  sheet_name: "TGB Yeni Maaş Dosyası",
  kurum_kodu: "633741",
  sube_kodu: "493",
  hesap: "6297485",
  doviz: "TL ", // sondaki boşluk dahil — banka şablonu böyle
  odeme_tipi: "M", // MAAŞ
  borc_izahat: "MAAS ODEMESI",
  banka_kodu: "62", // Garanti — havale
  satir_izahat: "maaş ödemesi",
} as const;

export const ODEME_TIPLERI: ReadonlyArray<[string, string]> = [
  ["O", "SOSYAL YARDIM"],
  ["D", "DÖNER SERMAYE"],
  ["C", "KOMİSYON"],
  ["F", "FAZLA MESAİ"],
  ["I", "İKRAMİYE"],
  ["K", "KIDEM TAZMİNATI"],
  ["M", "MAAŞ"],
  ["N", "AVANS"],
  ["G", "PROMOSYON"],
  ["R", "PRİM ÖDEMESİ"],
  ["S", "EK DERS ÜCRETİ"],
  ["H", "HUZUR HAKKI"],
  ["V", "ASGARİ GEÇİM İNDİRİMİ"],
  ["Y", "YOLLUK"],
  ["Z", "DİĞER"],
  ["X", "KESİNTİ"],
];
