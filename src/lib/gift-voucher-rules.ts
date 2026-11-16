/**
 * HEDİYE ÇEKİ KAMPANYASI — Mavi'de kazanılır, Derimod'da harcanır.
 *
 * Kademeler (sahibi, 16.11.2026, elle yazdığı tablo):
 *    5.000 –  7.000 →   500
 *    7.000 –  9.000 →   750
 *    9.000 – 14.000 → 1.000
 *   14.000 – 17.000 → 1.500
 *   17.000 – 20.000 → 1.750
 *   20.000 ve üzeri → 2.000
 *
 * SINIR KURALI: tabloda sınırlar iki satırda da geçiyor (7.000 hem üstte hem
 * altta). Sınırdaki tutar ÜST kademeye sayılır — tam 7.000 ₺ → 750 ₺.
 * Değişirse yalnız bu dosya değişir.
 *
 * BASILI KÜPÜRLER yalnız 500 / 750 / 1.000'dir (EAN-13: 290 + 05/07/10 + sıra).
 * 1.500 ve üstü hak ediş birden çok çekle verilir (1.500 = 1.000 + 500).
 * Bu yüzden kontrol "fiş başına tek çek" değil, "fişe bağlanan çeklerin
 * TOPLAMI hak edişi aşmamalı" diye yapılır.
 */

export type VoucherTier = {
  /** Alt sınır dahil. */
  min: number;
  /** Üst sınır hariç (bir sonraki kademenin min'i); son kademede null. */
  max: number | null;
  /** Hak edilen toplam çek tutarı. */
  voucher: number;
};

export const VOUCHER_TIERS: readonly VoucherTier[] = [
  { min: 5000, max: 7000, voucher: 500 },
  { min: 7000, max: 9000, voucher: 750 },
  { min: 9000, max: 14000, voucher: 1000 },
  { min: 14000, max: 17000, voucher: 1500 },
  { min: 17000, max: 20000, voucher: 1750 },
  { min: 20000, max: null, voucher: 2000 },
];

/** Basılan küpürler — hak ediş bunların toplamıyla karşılanır. */
export const VOUCHER_DENOMINATIONS = [1000, 750, 500] as const;

/** Alışveriş tutarının hak ettiği TOPLAM çek tutarı (5.000 altı → 0). */
export function entitlementFor(amount: number): number {
  if (!Number.isFinite(amount) || amount < VOUCHER_TIERS[0]!.min) return 0;
  for (const t of VOUCHER_TIERS) {
    if (amount >= t.min && (t.max === null || amount < t.max)) return t.voucher;
  }
  return 0;
}

/** Hangi kademe? (ekranda "7.000 – 9.000" diye göstermek için) */
export function tierFor(amount: number): VoucherTier | null {
  if (!Number.isFinite(amount)) return null;
  return VOUCHER_TIERS.find((t) => amount >= t.min && (t.max === null || amount < t.max)) ?? null;
}

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function tierLabel(t: VoucherTier): string {
  return t.max === null
    ? `${t.min.toLocaleString("tr-TR")} ₺ ve üzeri`
    : `${t.min.toLocaleString("tr-TR")} – ${t.max.toLocaleString("tr-TR")} ₺`;
}

/**
 * Hak edişi basılı küpürlerle böl: 1.500 → [1000, 500]. Tam bölünemezse
 * (kampanya değişirse) kalan `rest` olarak döner.
 */
export function splitIntoDenominations(total: number): { parts: number[]; rest: number } {
  const parts: number[] = [];
  let left = Math.round(total);
  for (const d of VOUCHER_DENOMINATIONS) {
    while (left >= d) {
      parts.push(d);
      left -= d;
    }
  }
  return { parts, rest: left };
}

/**
 * SÜRE KURALI (sahibi, 16.11.2026):
 * 27.07.2026'dan İTİBAREN yapılan alışverişlerin çeki 1 ay geçerlidir.
 * DAHA ESKİ alışverişlerden kazanılan çekler SÜRESİZDİR — o müşterilere
 * tarih verilmemişti, sonradan süre dayatılmaz.
 */
export const VOUCHER_EXPIRY_RULE_FROM = "2026-07-27";
export const VOUCHER_VALID_MONTHS = 1;

/** Bu alışverişin çekinin süresi var mı? (27.07.2026 öncesi: yok) */
export function hasExpiry(purchaseIso: string): boolean {
  return purchaseIso >= VOUCHER_EXPIRY_RULE_FROM;
}

/**
 * Son kullanma günü: fiş tarihi + 1 ay (ay sonu taşması kırpılır).
 * 27.07.2026 öncesi alışverişlerde süre yoktur → null.
 */
export function voucherDeadline(purchaseIso: string): string | null {
  if (!hasExpiry(purchaseIso)) return null;
  return addOneMonth(purchaseIso);
}

function addOneMonth(purchaseIso: string): string {
  const [y, m, d] = purchaseIso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + VOUCHER_VALID_MONTHS, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type VoucherCheckInput = {
  /** Mavi fişinin tutarı (SAP'tan; fotoğraftan değil). null = fiş henüz bulunamadı. */
  receipt_amount: number | null;
  /** Fişin tarihi (YYYY-MM-DD). */
  receipt_date: string | null;
  /** Fiş iade mi (SAP'ta "İade" işlem tipi). */
  receipt_refund?: boolean;
  /** Bu fişe bağlı DİĞER çeklerin toplamı (bu çek hariç). */
  other_vouchers_total: number;
  /** Kontrol edilen çekin tutarı. */
  voucher_amount: number;
  /** Çekin Derimod'da kullanıldığı gün (YYYY-MM-DD). */
  used_date: string | null;
  /** Mavi'nin o güne ait SAP dosyası sisteme geldi mi? */
  source_loaded: boolean;
};

export type VoucherCheckResult = {
  status: "ok" | "pending" | "fail";
  /** Kullanıcıya gösterilecek kısa sebepler; "ok" iken boş. */
  reasons: string[];
  entitlement: number;
  tier: VoucherTier | null;
  /** Son kullanma günü; 27.07.2026 öncesi alışverişte null (süresiz). */
  deadline: string | null;
  /** Bu çek süresiz mi (eski kampanya)? */
  unlimited: boolean;
};

/**
 * Tek bir çeki denetler. Satışı ENGELLEMEZ — sonradan yapılan kontroldür.
 * "pending": Mavi dosyası henüz gelmediği için karar verilemiyor.
 */
export function checkVoucher(a: VoucherCheckInput): VoucherCheckResult {
  const tier = a.receipt_amount == null ? null : tierFor(a.receipt_amount);
  const entitlement = a.receipt_amount == null ? 0 : entitlementFor(a.receipt_amount);
  const deadline = a.receipt_date ? voucherDeadline(a.receipt_date) : null;
  const reasons: string[] = [];

  if (a.receipt_amount == null) {
    return a.source_loaded
      ? {
          status: "fail",
          reasons: ["Bu fiş numarası Mavi kayıtlarında yok — fiş sahte ya da numara yanlış."],
          entitlement: 0,
          tier: null,
          deadline: null,
          unlimited: false,
        }
      : {
          status: "pending",
          reasons: ["Mavi'nin o güne ait bayi dosyası henüz yüklenmedi; dosya gelince kendiliğinden kontrol edilecek."],
          entitlement: 0,
          tier: null,
          deadline: null,
          unlimited: false,
        };
  }

  if (a.receipt_refund) reasons.push("Bu fiş SAP'ta iade olarak görünüyor.");
  if (entitlement === 0) {
    reasons.push(`Fiş ${fmt(a.receipt_amount)} ₺ — 5.000 ₺ altı, çek hak edilmiyor.`);
  } else {
    const used = a.other_vouchers_total + a.voucher_amount;
    if (used > entitlement + 0.005) {
      reasons.push(
        a.other_vouchers_total > 0
          ? `Bu fişe bağlı çekler ${fmt(used)} ₺ oldu; hak ediş ${fmt(entitlement)} ₺ (${fmt(a.other_vouchers_total)} ₺ zaten bağlıydı).`
          : `Çek ${fmt(a.voucher_amount)} ₺ ama bu fişin hak edişi ${fmt(entitlement)} ₺.`
      );
    }
  }
  if (a.used_date && deadline && a.used_date > deadline) {
    reasons.push(`Çek ${a.used_date.split("-").reverse().join(".")}'de kullanılmış; son gün ${deadline.split("-").reverse().join(".")} idi.`);
  }
  if (a.receipt_date && a.used_date && a.used_date < a.receipt_date) {
    reasons.push("Çek, fişin tarihinden ÖNCE kullanılmış.");
  }

  return {
    status: reasons.length ? "fail" : "ok",
    reasons,
    entitlement,
    tier,
    deadline,
    unlimited: a.receipt_date ? !hasExpiry(a.receipt_date) : false,
  };
}

/**
 * ÇEK BARKODU — EAN-13: `290` + küpür(05/07/10) + 7 hane sıra + kontrol hanesi.
 * Örn 500 ₺ #1 = 2900500000013. Nebim'e bu numara SerialNumber olarak yüklendi,
 * yani okutulan barkod çekin kimliğidir.
 */
export const VOUCHER_BARCODE_PREFIX = "290";

const DENOM_BY_CODE: Record<string, number> = { "05": 500, "07": 750, "10": 1000 };

/** EAN-13 kontrol hanesi doğru mu? */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export type ParsedVoucherBarcode =
  | { ok: true; barcode: string; amount: number; sequence: string }
  | { ok: false; reason: string };

/** Okutulan barkodu çöz: küpür ve sıra numarası. Boşluklar temizlenir. */
export function parseVoucherBarcode(raw: string): ParsedVoucherBarcode {
  const code = (raw ?? "").replace(/\D/g, "");
  if (code.length !== 13) return { ok: false, reason: "Barkod 13 haneli olmalı (EAN-13)." };
  if (!code.startsWith(VOUCHER_BARCODE_PREFIX)) {
    return { ok: false, reason: "Bu bir Derimod hediye çeki barkodu değil (290 ile başlamalı)." };
  }
  if (!isValidEan13(code)) return { ok: false, reason: "Barkodun kontrol hanesi tutmuyor — yanlış okunmuş olabilir." };
  const amount = DENOM_BY_CODE[code.slice(3, 5)];
  if (!amount) return { ok: false, reason: "Barkoddaki küpür tanınmadı (05 / 07 / 10 bekleniyor)." };
  return { ok: true, barcode: code, amount, sequence: code.slice(5, 12) };
}
