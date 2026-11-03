/**
 * KKTC resmî tatil takvimi — Naturel İK'daki HrHoliday tablosunun kopyası
 * (03.11.2026). Mesai ayrımında kullanılır: resmî tatilde girilen 8 saat
 * ücret değil HAK GÜNÜDÜR (sahibi, 03.11.2026: "özel günlerde de 8 saat
 * girerler, onlar da ek mesai değil izindir"). Yeni yıl gelince Naturel
 * İK'daki listeyle birlikte güncellenir.
 */
export const PUBLIC_HOLIDAYS: Readonly<Record<string, string>> = {
  "2026-01-01": "Yılbaşı",
  "2026-03-20": "Ramazan Bayramı 1. gün",
  "2026-03-21": "Ramazan Bayramı 2. gün",
  "2026-03-22": "Ramazan Bayramı 3. gün",
  "2026-04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
  "2026-05-01": "İşçi ve Bahar Bayramı",
  "2026-05-19": "Gençlik ve Spor Bayramı",
  "2026-05-27": "Kurban Bayramı 1. gün",
  "2026-05-28": "Kurban Bayramı 2. gün",
  "2026-05-29": "Kurban Bayramı 3. gün",
  "2026-05-30": "Kurban Bayramı 4. gün",
  "2026-07-20": "Barış ve Özgürlük Bayramı",
  "2026-08-01": "Toplumsal Direniş Bayramı",
  "2026-08-25": "Mevlid Kandili",
  "2026-08-30": "Zafer Bayramı",
  "2026-10-29": "Türkiye Cumhuriyet Bayramı",
  "2026-11-15": "KKTC Cumhuriyet Bayramı",
  "2027-01-01": "Yılbaşı",
  "2027-03-09": "Ramazan Bayramı 1. gün",
  "2027-03-10": "Ramazan Bayramı 2. gün",
  "2027-03-11": "Ramazan Bayramı 3. gün",
  "2027-04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
  "2027-05-01": "İşçi ve Bahar Bayramı",
  "2027-05-16": "Kurban Bayramı 1. gün",
  "2027-05-17": "Kurban Bayramı 2. gün",
  "2027-05-18": "Kurban Bayramı 3. gün",
  "2027-05-19": "Kurban Bayramı 4. gün + Gençlik ve Spor Bayramı",
  "2027-07-20": "Barış ve Özgürlük Bayramı",
  "2027-08-01": "Toplumsal Direniş Bayramı",
  "2027-08-14": "Mevlid Kandili",
  "2027-08-30": "Zafer Bayramı",
  "2027-10-29": "Türkiye Cumhuriyet Bayramı",
  "2027-11-15": "KKTC Cumhuriyet Bayramı",
};

export function isPublicHoliday(isoDate: string): boolean {
  return isoDate.slice(0, 10) in PUBLIC_HOLIDAYS;
}

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];

/**
 * Açıklama bir resmî tatil TARİHİNİ anıyor mu? Kayıt bazen tatilin ertesine girilir:
 * 30.10 "29 Ekim mesaisi — o gün mesai saatim var olduğu için bu tarihe girdim".
 * `folded`: küçük harf, aksansız, ı→i metin. Yıl, kaydın yılıdır.
 */
export function mentionsPublicHoliday(folded: string, year: number): boolean {
  const re = /(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)/g;
  for (let m = re.exec(folded); m; m = re.exec(folded)) {
    const d = String(Number(m[1])).padStart(2, "0");
    const mo = String(MONTHS.indexOf(m[2]!) + 1).padStart(2, "0");
    if (`${year}-${mo}-${d}` in PUBLIC_HOLIDAYS) return true;
  }
  return false;
}
