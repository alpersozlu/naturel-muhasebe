import { CREDIT_GRACE_DAYS_AT_MONTH_END, CREDIT_REMIND_STAFF_DAYS, CREDIT_WARN_MANAGER_DAYS } from "./rules";
import { addDays, daysBetween, isSunday, monthEnd } from "./dates";

/**
 * HAK GÜNÜ TAKİBİ — saf hesap, ağ ve veritabanı yok.
 *
 * Kolay İK'daki elle döngü (sahibi, 21.10.2026): personel pazar / bayram
 * çalışınca 8 saat mesai girer → sahibi elle 1 gün "Ekstra İzin" ekler →
 * personel o günü kullanır, "Yıllık İzin" türünde girildiği için yıllık
 * izninden düşer. Ağu–Eki 2026'da 200 iznin 123'ü böyle karşılık günüydü.
 *
 * Burada:
 *   1. Personel "Pazar / bayram çalıştım" der, müdür onaylar → 1 HAK GÜNÜ doğar
 *      (`WorkCredit`). Ayrı bir iş yoktur; onay = gün eklendi.
 *   2. Personel "Hak günümü kullanıyorum" der (`LieuUse`), müdür onaylar → en
 *      eski açık hak gününden düşer. Yıllık izne DOKUNMAZ.
 *   3. Son gün çalışılan ayın son günüdür (`creditDeadline`). Pazar sıkı
 *      takip edilir (süre geçerse KIRMIZI), bayram yumuşak (TURUNCU).
 *      Süresi geçen gün silinmez, bakiyede kırmızı durur (sahibi). Kişi
 *      ayrılırken açık kalan hak günleri ÖDENİR (net ÷ 26 / gün) — `balance`.
 *   4. Karşılık günü resmi tatile denk gelirse düşülmez — kişi o gün zaten
 *      izinliydi, hak günü açık kalır (devir kuralı).
 */

export type CreditKind = "sunday" | "holiday";
export type ApprovalStatus = "approved" | "waiting" | "rejected";

export type WorkCredit = { id: string; personId: string; date: string; status: ApprovalStatus };
export type LieuUse = { id: string; personId: string; date: string; status: ApprovalStatus };

/** Kimin, hangi aciliyetle haberdar edileceği. */
export type CreditState =
  | "used" // karşılığı kullanıldı
  | "open" // açık, süre bol
  | "remind" // son günler — personele hatırlatma
  | "warn" // son günler — müdür ve yönetici de uyarılır
  | "overdue"; // süre geçti, bakiyede bekliyor

export type SettledCredit = WorkCredit & {
  kind: CreditKind;
  deadline: string;
  daysLeft: number;
  state: CreditState;
  /** Ekrandaki renk: pazar gecikmesi kırmızı, bayram gecikmesi turuncu */
  tone: "green" | "neutral" | "yellow" | "amber" | "red";
  usedOn: string | null;
  usedBy: string | null;
};

export function creditKind(date: string, holidays: ReadonlySet<string>): CreditKind | null {
  if (holidays.has(date)) return "holiday"; // pazara denk gelen bayram bayram sayılır
  if (isSunday(date)) return "sunday";
  return null;
}

/**
 * Hak gününün en son kullanılabileceği gün: çalışılan ayın son günü. Ay
 * içinde pazar ve tatil olmayan boş gün kalmadıysa (ör. 31 Mayıs pazar) süre
 * çalışılan günden `CREDIT_GRACE_DAYS_AT_MONTH_END` gün sonrasına uzar.
 */
export function creditDeadline(date: string, holidays: ReadonlySet<string>): string {
  const end = monthEnd(date);
  for (let d = addDays(date, 1); d <= end; d = addDays(d, 1)) {
    if (!isSunday(d) && !holidays.has(d)) return end;
  }
  return addDays(date, CREDIT_GRACE_DAYS_AT_MONTH_END);
}

function stateOf(kind: CreditKind, daysLeft: number): Pick<SettledCredit, "state" | "tone"> {
  if (daysLeft < 0) return { state: "overdue", tone: kind === "sunday" ? "red" : "amber" };
  if (kind === "sunday" && daysLeft <= CREDIT_WARN_MANAGER_DAYS) return { state: "warn", tone: "red" };
  if (daysLeft <= CREDIT_REMIND_STAFF_DAYS) return { state: "remind", tone: "yellow" };
  return { state: "open", tone: "neutral" };
}

export type CreditLedger = {
  credits: SettledCredit[];
  /** Hak günü olmadan alınmış karşılık günleri — önce izin, sonra pazar mı? müdüre sorulur */
  unmatchedUses: LieuUse[];
  /** Resmi tatile denk geldiği için düşülmeyen karşılık günleri */
  holidayUses: LieuUse[];
  /** Açık (kullanılmamış) onaylı hak günü sayısı */
  balance: number;
};

/**
 * Bir kişinin onaylı hak günlerini onaylı kullanımlarla eşleştirir. Her
 * kullanım, kendinden ÖNCE çalışılmış en eski açık hak gününü kapatır.
 */
export function settleCredits(
  credits: ReadonlyArray<WorkCredit>,
  uses: ReadonlyArray<LieuUse>,
  holidays: ReadonlySet<string>,
  today: string
): CreditLedger {
  const open = credits
    .filter((c) => c.status === "approved")
    .map((c) => {
      const kind = creditKind(c.date, holidays) ?? "sunday";
      const deadline = creditDeadline(c.date, holidays);
      return { ...c, kind, deadline, usedOn: null as string | null, usedBy: null as string | null };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const unmatchedUses: LieuUse[] = [];
  const holidayUses: LieuUse[] = [];
  const approvedUses = uses.filter((u) => u.status === "approved").sort((a, b) => a.date.localeCompare(b.date));
  for (const u of approvedUses) {
    if (holidays.has(u.date)) {
      holidayUses.push(u);
      continue;
    }
    const c = open.find((x) => x.usedBy === null && x.date < u.date);
    if (c) {
      c.usedBy = u.id;
      c.usedOn = u.date;
    } else unmatchedUses.push(u);
  }

  const settled: SettledCredit[] = open.map((c) => {
    const daysLeft = daysBetween(today, c.deadline);
    if (c.usedBy) return { ...c, daysLeft, state: "used", tone: "green" };
    return { ...c, daysLeft, ...stateOf(c.kind, daysLeft) };
  });
  return { credits: settled, unmatchedUses, holidayUses, balance: settled.filter((c) => c.state !== "used").length };
}

export type CreditAlert = {
  personId: string;
  creditId: string;
  date: string;
  kind: CreditKind;
  deadline: string;
  daysLeft: number;
  /** Kime gider: personel her zaman; müdür + yönetici "warn" ve "overdue"da */
  audience: Array<"staff" | "manager" | "admin">;
  tone: SettledCredit["tone"];
};

/**
 * Bugün gönderilecek hak günü uyarıları. Bayram gecikmesi müdür + yöneticiye
 * bilgi olarak gider; pazar için son `CREDIT_WARN_MANAGER_DAYS` gün de gider.
 */
export function creditAlerts(ledger: CreditLedger): CreditAlert[] {
  const out: CreditAlert[] = [];
  for (const c of ledger.credits) {
    if (c.state === "used" || c.state === "open") continue;
    const audience: CreditAlert["audience"] = c.state === "remind" ? ["staff"] : ["staff", "manager", "admin"];
    out.push({ personId: c.personId, creditId: c.id, date: c.date, kind: c.kind, deadline: c.deadline, daysLeft: c.daysLeft, audience, tone: c.tone });
  }
  return out;
}
