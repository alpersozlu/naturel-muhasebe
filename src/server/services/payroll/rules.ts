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
/**
 * Parfüm primi — yalnız Mavi kasiyeri, adet başına. KALDIRILDI (sahibi, 03.10.2026:
 * "parfüm primi kalktığı için parfüm adedine gerek yok") — Eylül 2026'dan itibaren kimsede
 * perfume_eligible işaretli değil, giriş alanı görünmez. Sabit, eski ayların (Ağustos 2026
 * ve öncesi) bordrosu aynı hesaplansın diye duruyor.
 */
export const PERFUME_PREMIUM_PER_UNIT = 50;
/** Giysi primi — Derimod personeli, adet başına. */
export const GARMENT_PREMIUM_PER_UNIT = 200;
/**
 * Çalışma izni yıllık maliyeti; erken ayrılan kalan ayları öder (ay bazında).
 * KURAL (sahibi, 02.10.2026): bir yıldan uzun süredir çalışanlardan çalışma izni
 * ücreti KESİLMEZ; yalnız ilk yılındakilerden tek seferde kesilir.
 */
export const WORK_PERMIT_ANNUAL_COST = 17000;
/** Avans netin bu oranını geçerse uyarı (Mevlüde %74, Emre %57 olmuştu). */
export const ADVANCE_WARN_SHARE = 0.5;
/** Kesinti + avans sonrası eline bu tutardan az geçecekse uyarı (Bagtyyar 0,31 ₺ kalacaktı). */
export const NEAR_ZERO_TL = 2500;
/** Asgari ücret — Temmuz 2026'dan itibaren. */
export const MIN_WAGE = { gross: 70893, net: 61677 } as const;

/**
 * DEPO PERSONELİ (sahibi, 05.10.2026: "depocuların primi — ekleme için sadece
 * ek mesaisine bakacağız, çıkarmalarına bakacağız, mesela fiyat farkı gibi").
 *
 * Prim / komisyon YOKTUR. Ödeme 2'de eklenen tek kalem EK MESAİ'dir (saat ×
 * net baz ÷ 208); kesintiler (fiyat farkı, kasa eksiği, faturasız masraf…)
 * ondan düşülür. Top-seller, giysi / parfüm primi ve "ek prim" depocuya
 * işlemez; komisyon profili "Komisyon yok" olmalıdır.
 *
 * Kural görev adına bağlıdır (position serbest metindir): "Depo", "Depocu",
 * "Depo Sorumlusu"… Lojistik ayrı bir görevdir, bu kurala girmez.
 */
export function isOvertimeOnlyPosition(position: string | null | undefined): boolean {
  return (position ?? "").toLocaleLowerCase("tr").includes("depo");
}

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

/**
 * SONRAKİ AYA DEVİR (sahibi, 05.10.2026: "ertesi aya devret ekleyebilirsin").
 *
 * Maaş ödendikten sonra girilen bir kesinti o ayın ekstrasını (mesai, prim)
 * aşarsa — depocuda sık olur: prim yok, yalnız mesai var — aşan kısım o ay
 * kesilemez: Net Kalan eksiye düşer ve ay kapanmaz. "Sonraki aya devret" iki
 * BAĞLI kayıt yazar (PayrollEntry.carry_id ortak):
 *   bu ay      addition / carry_forward  → bakiyeyi sıfırlar, hak ediş DEĞİLDİR
 *   sonraki ay deduction / carry_over    → o ayın maaşından düşer
 * Biri iptal edilince diğeri de iptal edilir. Elle seçilecek bir kategori
 * değildir; yalnız bu işlem oluşturur.
 */
export const CARRY_FORWARD_CATEGORY = "carry_forward";
export const CARRY_FORWARD_LABEL = "Sonraki aya devredildi";

export const PAYMENT_CATEGORIES = {
  payment1: "Ödeme 1 — baz maaş",
  payment2: "Ödeme 2 — mesai + komisyon + prim",
  single: "Tekil / dönem dışı ödeme",
  cash: "Nakit ödeme",
} as const;
export type PaymentCategory = keyof typeof PAYMENT_CATEGORIES;

/**
 * ÖDEME 2 NAKİT ÖDENİR (sahibi, 05.10.2026: "burada Garanti'den ve Ziraat'tan
 * ödemeyiz, bütün bu Ödeme 2'yi nakit ile yaparız").
 *
 * Maaşını (Ödeme 1) bankadan alan da mesai / komisyon / primini ELDEN alır.
 * Bu yüzden Ödeme 2 için banka talimatı hazırlanmaz ve nakit listesine kişinin
 * maaş kanalına bakılmadan Ödeme 2'si olan HERKES girer. Avans ve Ödeme 1'de
 * ise kişi yalnız kendi maaş kanalının listesinde görünür.
 */
export const PAYMENT2_CHANNEL = "cash" as const;

/** Bu tür ödeme bu kanaldan yapılabilir mi? Yapılamıyorsa nedenini döner. */
export function batchChannelError(kind: string, channel: string): string | null {
  if (kind === "payment2" && channel !== PAYMENT2_CHANNEL) return "Ödeme 2 nakit ödenir — Garanti ya da Ziraat talimatı hazırlanmaz.";
  return null;
}

/** Kişi bu talimat / listeye girer mi? (kind + channel → maaş kanalı pay_method) */
export function inBatchList(kind: string, channel: string, payMethod: string): boolean {
  if (kind === "payment2") return channel === PAYMENT2_CHANNEL; // herkese nakit
  return payMethod === channel;
}

/**
 * MAĞAZA MAĞAZA NAKİT KAYDI (sahibi, 05.10.2026: "mağaza mağaza kaydedebilirsem
 * daha rahat olur, mağazayı ödediğimde tıklayayım"). Ödeme 2 nakit penceresinde
 * her mağaza kendi düğmesiyle AYRI bir liste olarak kaydedilir; tek mağazalık
 * nakit listesinin başlığına mağazanın adı girer ki listeler birbirinden ayrılsın.
 */
export function batchTitle(a: {
  period: string;
  kind: string;
  channel: "garanti" | "ziraat" | "cash";
  stores: string[];
  pay_date: string;
}): string {
  const channel = a.channel === "garanti" ? "Garanti" : a.channel === "cash" ? "Nakit" : "Ziraat";
  const store = a.channel === "cash" && a.stores.length === 1 ? ` · ${a.stores[0]}` : "";
  return `${a.period} · ${a.kind} · ${channel}${store} · ${a.pay_date}`;
}

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
