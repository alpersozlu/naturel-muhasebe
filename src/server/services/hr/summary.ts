import { annualLeaveEarned } from "./accrual";
import { settleCredits, type CreditLedger, type LieuUse } from "./credits";
import { addDays, isSunday, monthEnd } from "./dates";
import { SICK_DAYS_PER_YEAR, type LeaveKind } from "./rules";

/**
 * KİŞİ ÖZETİ — saf hesap. Personel ekranının üst kartları, müdürün "izin
 * kullanmamış" listesi ve sahibinin genel bakışı aynı sayıları buradan alır.
 */

export type Status = "waiting" | "approved" | "rejected" | "cancelled";

export type SummaryInput = {
  employeeId: string;
  /** İşe giriş — null ise yıllık izin hesaplanamaz */
  hireDate: string | null;
  endDate: string | null;
  today: string;
  holidays: ReadonlySet<string>;
  /** Bu yıla devreden yıllık izin */
  opening: number;
  workedDays: ReadonlyArray<{ id: string; date: string; status: Status }>;
  leaves: ReadonlyArray<{ id: string; kind: LeaveKind; start: string; end: string; days: number; status: Status }>;
  overtimes: ReadonlyArray<{ date: string; minutes: number; status: Status }>;
};

export type HrSummary = {
  annual: {
    known: boolean;
    opening: number;
    earned: number;
    perMonth: number;
    nextAccrualDate: string | null;
    used: number;
    waiting: number;
    /** devreden + hak edilen − kullanılan (bekleyenler düşülmeden) */
    remaining: number;
    /**
     * EKRANDA GÖRÜNEN: kalan iznin TAM gün kısmı, yukarı yuvarlanmaz (sahibi,
     * 22.10.2026: "5,17 de 5,8 de 5 gün; 6 olunca 6"). Eksi bakiye de aşağı
     * gider (−0,5 → −1).
     */
    whole: number;
    /** Bekleyen talepler düşülünce yeni talepte kullanılabilecek tam gün */
    wholeAvailable: number;
    /** Ekrandaki sayının 1 artacağı gün (ay sonu); yıl içinde yoksa null */
    nextWholeDayDate: string | null;
    /** Bu yıl hak edişi tamamlanan ay sayısı (Ocak'tan, işe giriş ayından) */
    months: number;
    /** Bu yıl çalışılacak ilk ay (1–12); işe yıl içinde girdiyse giriş ayı */
    firstMonth: number;
    /** Başka izin kullanmazsa yıl sonunda olacak tam gün */
    yearEndWhole: number | null;
  };
  lieu: CreditLedger & {
    /** Müdür onayı bekleyen pazar / bayram bildirimleri */
    waitingClaims: number;
    /** Onay bekleyen hak günü talepleri (gün) */
    waitingUses: number;
    /** Yeni hak günü talebinde kullanılabilecek */
    available: number;
  };
  sick: { allowance: number; used: number };
  overtimeMonth: { approvedMinutes: number; waitingMinutes: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const live = (s: Status) => s === "approved" || s === "waiting";
/** Tam gün, aşağı (5,8 → 5; 6 → 6; −0,5 → −1). Kayan nokta artığına karşı küçük pay. */
export const wholeDays = (n: number) => Math.floor(n + 1e-9);

/** Hak günü talebinin tek tek günleri (pazar ve resmi tatil hariç). */
export function expandLeaveDays(start: string, end: string, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isSunday(d) && !holidays.has(d)) out.push(d);
  return out;
}

export function buildHrSummary(i: SummaryInput): HrSummary {
  const year = Number(i.today.slice(0, 4));
  const inYear = (d: string) => d.startsWith(`${year}-`);

  // Yıllık izin
  const accrual = i.hireDate ? annualLeaveEarned({ hireDate: i.hireDate, endDate: i.endDate, year, asOf: i.today }) : null;
  const annualOf = (s: Status) =>
    round2(i.leaves.filter((l) => l.kind === "annual" && l.status === s && inYear(l.start)).reduce((a, l) => a + l.days, 0));
  const used = annualOf("approved");
  const earned = accrual?.days ?? 0;
  const remaining = round2(i.opening + earned - used);
  const whole = wholeDays(remaining);
  let nextWholeDayDate: string | null = null;
  if (accrual?.nextAccrualDate && i.hireDate) {
    for (let d = accrual.nextAccrualDate; d.startsWith(`${year}-`); d = monthEnd(addDays(d, 1))) {
      const e = annualLeaveEarned({ hireDate: i.hireDate, endDate: i.endDate, year, asOf: d }).days;
      if (wholeDays(round2(i.opening + e - used)) > whole) {
        nextWholeDayDate = d;
        break;
      }
    }
  }

  // Hak günü: onaylı hak günü talepleri tek tek günlere açılır, en eski pazarı kapatır
  const uses: LieuUse[] = [];
  for (const l of i.leaves) {
    if (l.kind !== "lieu" || l.status !== "approved") continue;
    expandLeaveDays(l.start, l.end, i.holidays).forEach((d, n) => uses.push({ id: `${l.id}#${n}`, personId: i.employeeId, date: d, status: "approved" }));
  }
  const ledger = settleCredits(
    i.workedDays.map((w) => ({ id: w.id, personId: i.employeeId, date: w.date, status: w.status === "approved" ? "approved" : w.status === "waiting" ? "waiting" : "rejected" })),
    uses,
    i.holidays,
    i.today
  );
  const waitingClaims = i.workedDays.filter((w) => w.status === "waiting").length;
  const waitingUses = round2(i.leaves.filter((l) => l.kind === "lieu" && l.status === "waiting").reduce((a, l) => a + l.days, 0));

  const month = i.today.slice(0, 7);
  const ot = i.overtimes.filter((o) => o.date.startsWith(month));

  return {
    annual: {
      known: !!accrual,
      opening: round2(i.opening),
      earned,
      perMonth: accrual?.perMonth ?? 0,
      nextAccrualDate: accrual?.nextAccrualDate ?? null,
      used,
      waiting: annualOf("waiting"),
      remaining,
      whole,
      wholeAvailable: wholeDays(round2(remaining - annualOf("waiting"))),
      nextWholeDayDate,
      months: accrual?.months ?? 0,
      firstMonth: i.hireDate && i.hireDate.startsWith(`${year}-`) ? Number(i.hireDate.slice(5, 7)) : 1,
      yearEndWhole: i.hireDate
        ? wholeDays(round2(i.opening + annualLeaveEarned({ hireDate: i.hireDate, endDate: i.endDate, year, asOf: `${year}-12-31` }).days - used))
        : null,
    },
    lieu: { ...ledger, waitingClaims, waitingUses, available: Math.max(0, round2(ledger.balance + waitingClaims - waitingUses)) },
    sick: {
      allowance: SICK_DAYS_PER_YEAR,
      used: round2(i.leaves.filter((l) => l.kind === "sick" && l.status === "approved" && inYear(l.start)).reduce((a, l) => a + l.days, 0)),
    },
    overtimeMonth: {
      approvedMinutes: ot.filter((o) => o.status === "approved").reduce((a, o) => a + o.minutes, 0),
      waitingMinutes: ot.filter((o) => o.status === "waiting").reduce((a, o) => a + o.minutes, 0),
    },
  };
}

/** Diğer izinlerle çakışma denetimi için canlı (bekleyen + onaylı) izin aralıkları. */
export function liveLeaveRanges(leaves: SummaryInput["leaves"]): Array<{ start: string; end: string }> {
  return leaves.filter((l) => live(l.status)).map((l) => ({ start: l.start, end: l.end }));
}

