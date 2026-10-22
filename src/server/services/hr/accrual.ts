import { ANNUAL_LEAVE_DAYS_PER_YEAR } from "./rules";
import { addDays, isSunday, monthEnd } from "./dates";

/**
 * YILLIK İZİN HAK EDİŞİ — saf hesap.
 *
 * Kolay İK yılın başında (ya da işe girişte) bütün yılın 14 gününü bakiyeye
 * yazar; yeni başlayan biri ilk gün "14 gün izni var" görünür. Bizde izin
 * ÇALIŞTIKÇA birikir: her tamamlanan takvim ayı sonunda 14 ÷ 12 gün eklenir
 * (6 ay = 7 gün = 1 hafta).
 *   • İşe başlanan ay tam sayılır (15 Mart'ta başlayan 31 Mart'ta ilk payını alır).
 *   • İçinde bulunulan ay, ay bitince sayılır.
 *   • Ay ortasında ayrılan o ayın payını ALMAZ (sahibi, 22.10.2026); ayın son
 *     günü ayrılan alır.
 * Kullanılmayan yıllık izin yeni yıla DEVREDER (sahibi, 21.10.2026); devreden gün
 * bu hesaba girmez, `opening` olarak ayrıca verilir.
 */
export type AccrualInput = {
  /** İşe giriş — YYYY-MM-DD */
  hireDate: string;
  /** Çıkış (varsa) — YYYY-MM-DD, son çalışılan gün */
  endDate?: string | null;
  /** Hangi yılın hak edişi */
  year: number;
  /** Bugün — YYYY-MM-DD */
  asOf: string;
};

export type Accrual = {
  /** Bu yıl hak edilmiş tamamlanan ay sayısı */
  months: number;
  /** Hak edilen gün (kuruş gibi 2 basamak) */
  days: number;
  /** Bir sonraki payın ekleneceği gün; çalışma bittiyse ya da yıl dolduysa null */
  nextAccrualDate: string | null;
  /** Ay başına eklenen gün */
  perMonth: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function annualLeaveEarned({ hireDate, endDate, year, asOf }: AccrualInput): Accrual {
  const perMonth = ANNUAL_LEAVE_DAYS_PER_YEAR / 12;
  let months = 0;
  let next: string | null = null;
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, "0")}-01`;
    const last = monthEnd(first);
    if (last < hireDate) continue; // henüz işe girmemiş
    if (endDate && first > endDate) break; // ayrılmış
    if (endDate && endDate < last) break; // ay ortasında ayrıldı → o ay sayılmaz
    if (last > asOf) {
      next = last; // bu ay henüz bitmedi
      break;
    }
    months += 1;
  }
  if (next && endDate && endDate < next) next = null;
  return { months, days: round2(months * perMonth), nextAccrualDate: next, perMonth: round2(perMonth) };
}

/** Kalan yıllık izin = devreden + hak edilen − kullanılan (eksi olabilir; ekran uyarır). */
export function annualLeaveBalance(input: AccrualInput & { opening?: number; used: number }) {
  const earned = annualLeaveEarned(input);
  const opening = input.opening ?? 0;
  return { ...earned, opening, used: input.used, remaining: round2(opening + earned.days - input.used) };
}

/**
 * İzin talebinin kaç gün düşeceği: başlangıç ↔ bitiş arası günler; PAZAR ve
 * resmi tatil sayılmaz (sahibi, 21.10.2026: "pazar günü izin günüdür").
 * DİKKAT: Kolay İK'daki kayıtlar pazarı saymış görünüyor (21.08–01.09 = 12 gün,
 * içinde iki pazar) — "MAVI DERIMOD IZIN KURALLARI" politikası okununca teyit.
 */
export function leaveDayCount(start: string, end: string, holidays: ReadonlySet<string>): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isSunday(d) && !holidays.has(d)) n += 1;
  return n;
}
