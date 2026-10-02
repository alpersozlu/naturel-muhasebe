/**
 * NTR bordro kuralları — Mert'in devir paketindeki "Kurallar ve Oranlar"
 * (Nisan 2026 onaylı komisyon tabloları, o tarihten beri değişmedi).
 *
 * Bu dosya tek gerçek kaynaktır: hesap motoru (compute.ts), bordro fişi ve
 * ekranlar oranları buradan okur. Oran değişirse yalnız burası değişir.
 */

/** Mesai saat ücreti = kişinin KENDİ aylık NET bazı ÷ 208. */
export const OVERTIME_DIVISOR = 208;
/** Tam zamanlı personel ayda 26 gün sayılır — izin gün ücreti = net ÷ 26. */
export const LEAVE_DAY_DIVISOR = 26;
/** Her Mavi mağazasında ayın en çok satan TEK kişisine. */
export const TOP_SELLER_PREMIUM = 3000;
/** Parfüm primi — yalnız Mavi kasiyeri, adet başına. */
export const PERFUME_PREMIUM_PER_UNIT = 50;
/** Giysi primi — Derimod personeli, adet başına. */
export const GARMENT_PREMIUM_PER_UNIT = 200;
/** Çalışma izni yıllık maliyeti; erken ayrılan kalan ayları öder (ay bazında). */
export const WORK_PERMIT_ANNUAL_COST = 17000;
/** Avans netin bu oranını geçerse uyarı (Mevlüde %74, Emre %57 olmuştu). */
export const ADVANCE_WARN_SHARE = 0.5;
/** Kesinti + avans sonrası eline bu tutardan az geçecekse uyarı (Bagtyyar 0,31 ₺ kalacaktı). */
export const NEAR_ZERO_TL = 2500;
/** Asgari ücret — Temmuz 2026'dan itibaren. */
export const MIN_WAGE = { gross: 70893, net: 61677 } as const;

export type MaviAsistanBracket = { min: number; nd: number; denim: number };
export type RateBracket = { min: number; rate: number };

/** MAVİ satış asistanı — KENDİ cirosu / KENDİ hedefi; iki oran (denim dışı / denim). */
export const MAVI_ASISTAN_TABLE: readonly MaviAsistanBracket[] = [
  { min: 0, nd: 0.002, denim: 0.007 },
  { min: 0.85, nd: 0.002, denim: 0.01 },
  { min: 0.9, nd: 0.003, denim: 0.012 },
  { min: 0.95, nd: 0.004, denim: 0.014 },
  { min: 1.0, nd: 0.005, denim: 0.015 },
  { min: 1.05, nd: 0.006, denim: 0.016 },
];

/** MAVİ mağaza müdürü — mağazanın TOPLAM cirosu / mağaza hedefi. */
export const MAVI_MUDUR_TABLE: readonly RateBracket[] = [
  { min: 0, rate: 0.0015 },
  { min: 0.95, rate: 0.002 },
  { min: 1.0, rate: 0.0025 },
  { min: 1.05, rate: 0.003 },
];

/** Müdür yardımcısı = müdür oranı × 0,75 (aynı mağaza cirosu). */
export const MAVI_VICE_FACTOR = 0.75;

/** DERİMOD satış asistanı — kendi cirosu. */
export const DERI_ASISTAN_TABLE: readonly RateBracket[] = [
  { min: 0, rate: 0.008 },
  { min: 0.9, rate: 0.01 },
  { min: 0.95, rate: 0.011 },
  { min: 1.0, rate: 0.012 },
  { min: 1.05, rate: 0.013 },
  { min: 1.1, rate: 0.014 },
];

/** DERİMOD mağaza müdürü — mağazanın TOPLAM cirosu. */
export const DERI_MUDUR_TABLE: readonly RateBracket[] = [
  { min: 0, rate: 0.004 },
  { min: 0.9, rate: 0.005 },
  { min: 1.0, rate: 0.0065 },
  { min: 1.1, rate: 0.008 },
];

/** Başarı oranına göre dilim: alt sınırı geçen SON satır. */
export function bracketFor<T extends { min: number }>(table: readonly T[], achievement: number): T {
  let hit = table[0]!;
  for (const b of table) if (achievement >= b.min - 1e-9) hit = b;
  return hit;
}

export const COMMISSION_PROFILES = [
  "mavi_asistan",
  "mavi_mudur",
  "mavi_vice",
  "deri_asistan",
  "deri_mudur",
  "none",
] as const;
export type CommissionProfile = (typeof COMMISSION_PROFILES)[number];

export const PROFILE_LABEL: Record<CommissionProfile, string> = {
  mavi_asistan: "Mavi satış asistanı (kendi cirosu, ND + denim)",
  mavi_mudur: "Mavi mağaza müdürü (mağaza cirosu)",
  mavi_vice: "Mavi müdür yardımcısı (müdür oranı × 0,75)",
  deri_asistan: "Derimod satış asistanı (kendi cirosu)",
  deri_mudur: "Derimod mağaza müdürü (mağaza cirosu)",
  none: "Komisyon yok",
};

export const PROFILE_SHORT: Record<CommissionProfile, string> = {
  mavi_asistan: "Mavi asistan",
  mavi_mudur: "Mavi müdür",
  mavi_vice: "Mavi müdür yrd.",
  deri_asistan: "Derimod asistan",
  deri_mudur: "Derimod müdür",
  none: "—",
};

export const PAY_METHODS = ["garanti", "ziraat", "cash"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  garanti: "Banka (Garanti talimatı)",
  ziraat: "Ziraat (talimat dışı)",
  cash: "Nakit",
};
export const PAY_METHOD_SHORT: Record<PayMethod, string> = {
  garanti: "Garanti",
  ziraat: "Ziraat",
  cash: "Nakit",
};

export const POSITIONS = [
  "Mağaza Müdürü",
  "Müdür Yardımcısı",
  "Satış Asistanı",
  "Kıdemli Danışman",
  "Kasiyer",
  "Depo",
  "Lojistik",
] as const;

// Sahibi (02.10.2026): kasa eksiği, fiyat farkı ve faturasız masraf gibi
// kesintileri maaş ödendikten SONRA, Ödeme 2'den (prim/mesai) kendisi keser.
export const DEDUCTION_CATEGORIES = {
  carry_over: "Önceki aydan devir",
  cash_shortfall: "Kasa eksiği / kasa farkı",
  price_difference: "Fiyat farkı",
  uninvoiced_expense: "Faturasız masraf (personele kesilen)",
  loan: "Şirket borcu geri ödemesi",
  work_permit: "Çalışma izni borcu",
  double_payment: "Çift ödeme tahsili",
  other: "Diğer kesinti",
} as const;
export type DeductionCategory = keyof typeof DEDUCTION_CATEGORIES;

export const ADDITION_CATEGORIES = {
  leave_payout: "İzin ödemesi (çıkış)",
  bonus: "Bonus / ödül",
  correction: "Düzeltme (eksik ödeme)",
  other: "Diğer ek hak ediş",
} as const;
export type AdditionCategory = keyof typeof ADDITION_CATEGORIES;

export const PAYMENT_CATEGORIES = {
  payment1: "Ödeme 1 — baz maaş",
  payment2: "Ödeme 2 — mesai + komisyon + prim",
  single: "Tekil / dönem dışı ödeme",
  cash: "Nakit ödeme",
} as const;
export type PaymentCategory = keyof typeof PAYMENT_CATEGORIES;

export const CHANNEL_LABEL = {
  garanti: "Garanti talimatı",
  ziraat: "Ziraat",
  cash: "Nakit",
  other: "Diğer",
} as const;

export const MONTH_NAMES_TR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES_TR[month - 1] ?? month} ${year}`;
}
