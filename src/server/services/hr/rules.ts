/**
 * NATUREL İK — izin / pazar çalışması / mesai kuralları (sahibi, 21.10.2026).
 *
 * Bu dosya tek gerçek kaynaktır: kural motoru (accrual.ts, credits.ts,
 * claims.ts) ve ekranlar sayıları buradan okur. Kural değişirse yalnız
 * burası değişir. Tasarım: docs/IK-MODULU-TASARIM.md.
 */

/**
 * YILLIK İZİN — "çalıştıkça hak edilir" (sahibi: "6 ay çalışıyorsa 1 hafta izin
 * kazanıyor … Kolay İK başlar başlamaz 2 hafta izin ile başlatıyor, o da
 * kalksın"). Yılda 14 gün, her TAMAMLANAN takvim ayı için 14 ÷ 12 gün.
 * İşe başlanan ay tam sayılır (Mert'in devir kuralı, çıkış hesaplarında da böyle).
 */
export const ANNUAL_LEAVE_DAYS_PER_YEAR = 14;

/**
 * PAZAR / BAYRAM ÇALIŞMASI = 1 HAK GÜNÜ (ücret değil, izin).
 * Personel saat yazmaz; gün sabit 8 saattir.
 */
export const CREDIT_DAY_MINUTES = 480;

/**
 * PAZAR / BAYRAMDA 8 SAATİN ÜSTÜ — markaya göre (sahibi, 22.10.2026):
 *   • MAVİ: en çok 8 saat, molalar kullanılır, mesai YAZILAMAZ ("kullanılmayan
 *     mola mesai sayılmaz — pazar günlerine geçerli, Mavi çalışanları için").
 *   • DERİMOD: 8 saatin üstü mesai yazılabilir, müdür onaylar. Önce o gün
 *     "Pazar / bayram çalıştım" ile bildirilir (8 saat = hak günü).
 */
export function restDayOvertimeAllowed(brandName: string | null | undefined): boolean {
  return /derimod/i.test(brandName ?? "");
}
/**
 * Pazar / bayram ek saati yasal olarak 2 kat ödenir. Personel GERÇEK saati yazar,
 * bordro bağlantısı (aşama 6) ×2 uygular. (Kolay İK'da personel saati kendisi
 * ikiyle çarpıp yazıyordu — sahibi, 05.10.2026.)
 */
export const REST_DAY_OVERTIME_MULTIPLIER = 2;

/**
 * Hak günü ay bitmeden kullanılır (sahibi: "pazarları kesinlikle yeni aya
 * geçilmeden emin olunacak ki izinleri kullanıldı; bayramlar da aynı şekilde
 * ama pazar gibi ciddi değil"). Bu kadar gün kala personele hatırlatma …
 */
export const CREDIT_REMIND_STAFF_DAYS = 7;
/** … bu kadar gün kala müdüre ve yöneticiye uyarı (sahibi: "ay bitmeden müdüre ve bana uyarı gelsin"). */
export const CREDIT_WARN_MANAGER_DAYS = 5;
/**
 * Ayın son günü çalışılan pazar / bayram için ay içinde boş gün kalmaz; o zaman
 * süre çalışılan günden bu kadar gün sonrasına uzar.
 */
export const CREDIT_GRACE_DAYS_AT_MONTH_END = 7;

/** HAFTA İÇİ FAZLA MESAİ — sebep listeden seçilir, müdür onaylar. */
export const OVERTIME_STEP_MINUTES = 30;
/**
 * Günlük sınır YOK (sahibi, 21.10.2026: "bazen sabaha kadar sayım yaparlar veya
 * sevkiyatlar olur … müdür onaylayacağı için kontrol edilerek yapılacak").
 * Bundan uzun kayıt müdürün onay listesinde "uzun mesai" diye işaretlenir …
 */
export const OVERTIME_REVIEW_MINUTES = 240;
/** … bu ise yalnız yazım hatasına karşı (tek günde 16 saatten fazla mesai olmaz). */
export const OVERTIME_MAX_MINUTES_PER_DAY = 960;

export type OvertimeReason = "opening_closing" | "stock_count" | "goods_receipt" | "busy" | "missed_break" | "other";

/**
 * Mesai sebepleri. "Molamı kullanamadım" hafta içi herkes için geçerli (sahibi,
 * 22.10.2026); Mavi'de pazar zaten mesai yazılamaz.
 */
export const OVERTIME_REASONS: ReadonlyArray<{ code: OvertimeReason; label: string; needsNote: boolean }> = [
  { code: "opening_closing", label: "Açılış ve kapanışta çalıştım", needsNote: false },
  { code: "stock_count", label: "Sayım", needsNote: false },
  { code: "goods_receipt", label: "Mal kabul / ürün indirme", needsNote: false },
  { code: "busy", label: "Mağaza çok yoğundu", needsNote: false },
  { code: "missed_break", label: "Molamı kullanamadım", needsNote: false },
  { code: "other", label: "Başka bir sebep", needsNote: true },
];

/** "Başka bir sebep" seçilince açıklama en az bu kadar harf. */
export const OVERTIME_NOTE_MIN_CHARS = 5;

/**
 * İZİN TÜRLERİ. Kolay İK'da yalnız iki tür vardı (Yıllık İzin, Hastalık İzni);
 * hastalık izni tek seferde en çok 1 gün girilebildiği için çok günlük
 * hastalıklar "Yıllık İzin" olarak girildi, pazar karşılıkları da öyle.
 * Burada her şey kendi türünde ve kendi bakiyesinden düşer. Tek talepte gün
 * sınırı yok (Kolay İK'daki 12 gün sınırı izinleri parça parça girdiriyordu).
 */
export type LeaveKind = "annual" | "lieu" | "sick" | "bereavement" | "unpaid";

export const LEAVE_KINDS: ReadonlyArray<{ code: LeaveKind; label: string; hint: string; halfDay: boolean }> = [
  { code: "lieu", label: "Hak günü (pazar / bayram karşılığı)", hint: "Çalıştığınız pazar ya da bayramın karşılığı. Yıllık izninizden düşmez.", halfDay: false },
  { code: "annual", label: "Yıllık izin", hint: "Çalıştıkça biriken izniniz. Pazar ve resmi tatil izinden düşmez.", halfDay: true },
  { code: "sick", label: "Hastalık izni", hint: "Hastaysanız. Yıllık izninizden düşmez.", halfDay: true },
  { code: "bereavement", label: "Vefat izni", hint: "Bir yakınınızı kaybettiyseniz. En çok 2 gün; fazlası için yıllık izin isteyin.", halfDay: false },
  { code: "unpaid", label: "Ücretsiz izin", hint: "Maaştan kesilir. Müdürünüzle konuşarak isteyin.", halfDay: true },
];

/** Hastalık izni hakkı — Kolay İK "MAVI DERIMOD IZIN KURALLARI": yılda 12 gün, ücretli. */
export const SICK_DAYS_PER_YEAR = 12;
/** Vefat izni — 2 gün ücretli, yıllık izinden düşmez (KKTC; bordro devri). */
export const BEREAVEMENT_MAX_DAYS = 2;
