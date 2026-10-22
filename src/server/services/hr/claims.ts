import {
  BEREAVEMENT_MAX_DAYS,
  LEAVE_KINDS,
  type LeaveKind,
  OVERTIME_MAX_MINUTES_PER_DAY,
  OVERTIME_NOTE_MIN_CHARS,
  OVERTIME_REASONS,
  OVERTIME_REVIEW_MINUTES,
  OVERTIME_STEP_MINUTES,
  type OvertimeReason,
} from "./rules";
import { creditKind, type CreditKind } from "./credits";
import { isIsoDate } from "./dates";
import { leaveDayCount } from "./accrual";

/**
 * PERSONEL BİLDİRİMLERİNİN DENETİMİ — kayıt açılmadan önce. Hata metinleri
 * doğrudan personelin ekranında görünür: kısa, sade, ne yapacağını söyler.
 */

export type ClaimResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * "Pazar / bayram çalıştım" bildirimi. Saat sorulmaz — gün 8 saattir,
 * karşılığı 1 hak günü. Yalnız pazar ya da takvimdeki bayram seçilebilir.
 */
export function checkWorkedDayClaim(input: {
  date: string;
  today: string;
  holidays: ReadonlySet<string>;
  /** Kişinin daha önce bildirdiği (reddedilmemiş) günler */
  alreadyClaimed: ReadonlySet<string>;
  /** Bu tarihten önceki günler kapanmıştır (bordro kapanışı) */
  lockedBefore?: string | null;
}): ClaimResult<{ kind: CreditKind }> {
  const { date, today, holidays, alreadyClaimed, lockedBefore } = input;
  if (!isIsoDate(date)) return { ok: false, error: "Tarih seçin." };
  if (date > today) return { ok: false, error: "Henüz gelmemiş bir gün bildirilemez. Çalıştığınız gün geçtikten sonra bildirin." };
  if (lockedBefore && date < lockedBefore) return { ok: false, error: "Bu ay kapandı. Mağaza müdürünüzle konuşun." };
  const kind = creditKind(date, holidays);
  if (!kind) return { ok: false, error: "Bu gün pazar ya da bayram değil. Hafta içi fazla çalıştıysanız “Mesai yazdım” bölümünü kullanın." };
  if (alreadyClaimed.has(date)) return { ok: false, error: "Bu günü zaten bildirdiniz." };
  return { ok: true, value: { kind } };
}

/**
 * Fazla mesai, yarım saatlik adımlarla. Günlük sınır yok — 4 saati aşan gün
 * müdüre `long` diye işaretlenir. Pazar / bayram: Mavi'de yazılamaz; Derimod'da
 * 8 saatin ÜSTÜ yazılır ve o gün önce "Pazar / bayram çalıştım" ile bildirilmiş
 * olmalı (`restDay` → bordroda ×2).
 */
export function checkOvertimeClaim(input: {
  date: string;
  today: string;
  minutes: number;
  reason: string;
  note?: string | null;
  holidays: ReadonlySet<string>;
  /** Kişinin o gün için daha önce yazdığı (reddedilmemiş) mesai dakikası */
  alreadyMinutes?: number;
  lockedBefore?: string | null;
  /** Marka pazar / bayram mesaisine izin veriyor mu (restDayOvertimeAllowed) */
  restDayAllowed?: boolean;
  /** O pazar / bayram "çalıştım" diye bildirilmiş mi (bekleyen ya da onaylı) */
  workedDayClaimed?: boolean;
}): ClaimResult<{ minutes: number; reason: OvertimeReason; note: string | null; long: boolean; restDay: boolean }> {
  const { date, today, minutes, reason, holidays, lockedBefore } = input;
  const note = input.note?.trim() || null;
  if (!isIsoDate(date)) return { ok: false, error: "Tarih seçin." };
  if (date > today) return { ok: false, error: "Henüz gelmemiş bir gün için mesai yazılamaz." };
  if (lockedBefore && date < lockedBefore) return { ok: false, error: "Bu ay kapandı. Mağaza müdürünüzle konuşun." };
  const restDay = !!creditKind(date, holidays);
  if (restDay && !input.restDayAllowed) {
    return {
      ok: false,
      error: "Pazar ve bayram günleri en çok 8 saat çalışılır, molalar kullanılır; mesai yazılmaz. O gün için “Pazar / bayram çalıştım” bildirimi yapın — karşılığında 1 gün izin kazanırsınız.",
    };
  }
  if (restDay && !input.workedDayClaimed) {
    return { ok: false, error: "Önce bu günü “Pazar / bayram çalıştım” ile bildirin (8 saat = 1 hak günü). Buraya yalnız 8 saatin üstündeki süreyi yazın." };
  }
  const r = OVERTIME_REASONS.find((x) => x.code === reason);
  if (!r) return { ok: false, error: "Listeden bir sebep seçin." };
  if (r.needsNote && (!note || note.length < OVERTIME_NOTE_MIN_CHARS)) return { ok: false, error: "Ne yaptığınızı kısaca yazın." };
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % OVERTIME_STEP_MINUTES !== 0) {
    return { ok: false, error: "Süreyi yarım saatlik adımlarla seçin (0,5 – 1 – 1,5 saat …)." };
  }
  const total = minutes + (input.alreadyMinutes ?? 0);
  if (total > OVERTIME_MAX_MINUTES_PER_DAY) {
    return { ok: false, error: `Bir günde ${OVERTIME_MAX_MINUTES_PER_DAY / 60} saatten fazla mesai yazılamaz. Süreyi kontrol edin.` };
  }
  return { ok: true, value: { minutes, reason: r.code, note, long: total > OVERTIME_REVIEW_MINUTES, restDay } };
}

/**
 * İzin talebi. Düşülecek gün = aradaki günler, pazar ve resmi tatil hariç;
 * yarım gün yalnız tek günlük talepte.
 *   • Hak günü: açık hak gününden fazla istenemez (önce pazar bildirilir).
 *   • Yıllık izin: kalanı aşarsa reddedilmez, `negative` işaretlenir — karar
 *     vaka vaka sahibinindir (Mihriban, 06.10.2026).
 *   • Vefat: en çok 2 gün.
 *   • Aynı günlere düşen başka bir izin varsa reddedilir.
 */
export function checkLeaveRequest(input: {
  kind: string;
  start: string;
  end: string;
  halfDay?: boolean;
  holidays: ReadonlySet<string>;
  /** Kullanılabilir hak günü (onaylı açık + bekleyen bildirimler − bekleyen hak günü talepleri) */
  lieuAvailable: number;
  /** Kalan yıllık izin (bekleyen talepler düşülmüş) */
  annualRemaining: number;
  /** Kişinin reddedilmemiş / iptal edilmemiş diğer izinleri */
  otherLeaves: ReadonlyArray<{ start: string; end: string }>;
  lockedBefore?: string | null;
}): ClaimResult<{ kind: LeaveKind; days: number; halfDay: boolean; negative: boolean }> {
  const { start, end, holidays, lockedBefore } = input;
  const k = LEAVE_KINDS.find((x) => x.code === input.kind);
  if (!k) return { ok: false, error: "İzin türünü seçin." };
  if (!isIsoDate(start) || !isIsoDate(end)) return { ok: false, error: "Başlangıç ve bitiş gününü seçin." };
  if (end < start) return { ok: false, error: "Bitiş günü başlangıçtan önce olamaz." };
  if (lockedBefore && start < lockedBefore) return { ok: false, error: "Bu ay kapandı. Mağaza müdürünüzle konuşun." };
  const halfDay = !!input.halfDay;
  if (halfDay && (!k.halfDay || start !== end)) {
    return { ok: false, error: k.halfDay ? "Yarım gün yalnız tek gün için seçilebilir." : "Bu izin türü yarım gün alınamaz." };
  }
  const full = leaveDayCount(start, end, holidays);
  if (full === 0) return { ok: false, error: "Seçtiğiniz günler pazar ya da resmi tatil — izin gerekmiyor." };
  const days = halfDay ? 0.5 : full;
  if (input.otherLeaves.some((o) => o.start <= end && o.end >= start)) {
    return { ok: false, error: "Bu günlerde zaten bir izin talebiniz var." };
  }
  if (k.code === "lieu" && days > input.lieuAvailable) {
    return {
      ok: false,
      error:
        input.lieuAvailable <= 0
          ? "Kullanılacak hak gününüz yok. Önce çalıştığınız pazarı ya da bayramı “Pazar / bayram çalıştım” ile bildirin."
          : `En çok ${input.lieuAvailable} hak günü kullanabilirsiniz.`,
    };
  }
  if (k.code === "bereavement" && days > BEREAVEMENT_MAX_DAYS) {
    return { ok: false, error: `Vefat izni en çok ${BEREAVEMENT_MAX_DAYS} gün. Fazlası için ayrıca yıllık izin isteyin.` };
  }
  return { ok: true, value: { kind: k.code, days, halfDay, negative: k.code === "annual" && days > input.annualRemaining } };
}
