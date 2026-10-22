import { describe, expect, it } from "vitest";
import { annualLeaveBalance, annualLeaveEarned, leaveDayCount } from "@/server/services/hr/accrual";
import { creditAlerts, creditDeadline, settleCredits, type LieuUse, type WorkCredit } from "@/server/services/hr/credits";
import { checkLeaveRequest, checkOvertimeClaim, checkWorkedDayClaim } from "@/server/services/hr/claims";
import { buildHrSummary, wholeDays, type SummaryInput } from "@/server/services/hr/summary";
import { restDayOvertimeAllowed } from "@/server/services/hr/rules";
import { buildFeed } from "@/server/services/hr/feed";
import { PROFILE_FIELDS, allowedUpdate, canSee, completeness, exitPreview, profileAlerts, tenure } from "@/server/services/hr/profile";

const NO_HOLIDAYS = new Set<string>();
// Örnek takvim — gerçek KKTC listesi programda sahibince girilecek.
const HOLIDAYS = new Set(["2026-05-01", "2026-10-29"]);

describe("yıllık izin — çalıştıkça hak edilir", () => {
  it("ilk gün sıfırdan başlar (Kolay İK gibi 14 günle değil)", () => {
    const a = annualLeaveEarned({ hireDate: "2026-03-15", year: 2026, asOf: "2026-03-15" });
    expect(a.days).toBe(0);
    expect(a.nextAccrualDate).toBe("2026-03-31");
  });
  it("6 ay çalışan 7 gün (1 hafta) kazanır; başlanan ay tam sayılır", () => {
    expect(annualLeaveEarned({ hireDate: "2026-03-15", year: 2026, asOf: "2026-08-31" }).days).toBe(7);
    expect(annualLeaveEarned({ hireDate: "2026-03-15", year: 2026, asOf: "2026-08-30" }).days).toBeCloseTo(5.83, 2);
  });
  it("yıl boyu çalışan 14 gün", () => {
    expect(annualLeaveEarned({ hireDate: "2020-01-01", year: 2026, asOf: "2026-12-31" }).days).toBe(14);
    expect(annualLeaveEarned({ hireDate: "2020-01-01", year: 2026, asOf: "2026-12-31" }).nextAccrualDate).toBeNull();
  });
  it("ay ortasında ayrılan o ayın payını almaz", () => {
    const a = annualLeaveEarned({ hireDate: "2020-01-01", endDate: "2026-09-15", year: 2026, asOf: "2026-10-21" });
    expect(a.months).toBe(8);
    expect(a.nextAccrualDate).toBeNull();
    expect(annualLeaveEarned({ hireDate: "2020-01-01", endDate: "2026-09-30", year: 2026, asOf: "2026-10-21" }).months).toBe(9);
  });
  it("bakiye = devreden + hak edilen − kullanılan", () => {
    expect(annualLeaveBalance({ hireDate: "2020-01-01", year: 2026, asOf: "2026-06-30", opening: 2, used: 5 }).remaining).toBe(4);
  });
  it("izin günü sayımında resmi tatil ve pazar düşülmez (pazar izin günüdür)", () => {
    expect(leaveDayCount("2026-04-29", "2026-05-02", HOLIDAYS)).toBe(3);
    expect(leaveDayCount("2026-10-17", "2026-10-20", HOLIDAYS)).toBe(3);
  });
});

describe("hak günü — süre", () => {
  it("son gün çalışılan ayın son günüdür", () => {
    expect(creditDeadline("2026-10-04", NO_HOLIDAYS)).toBe("2026-10-31");
    expect(creditDeadline("2026-10-25", NO_HOLIDAYS)).toBe("2026-10-31");
  });
  it("ayın son günü pazarsa süre 7 gün uzar", () => {
    expect(creditDeadline("2026-05-31", NO_HOLIDAYS)).toBe("2026-06-07");
  });
});

const credit = (id: string, date: string, status: WorkCredit["status"] = "approved"): WorkCredit => ({ id, personId: "p1", date, status });
const use = (id: string, date: string, status: LieuUse["status"] = "approved"): LieuUse => ({ id, personId: "p1", date, status });

describe("hak günü — eşleştirme ve uyarılar", () => {
  it("kullanım en eski açık pazarı kapatır, yıllık izne dokunmaz", () => {
    const l = settleCredits([credit("c1", "2026-10-04"), credit("c2", "2026-10-11")], [use("u1", "2026-10-13")], NO_HOLIDAYS, "2026-10-14");
    expect(l.credits.find((c) => c.id === "c1")?.state).toBe("used");
    expect(l.credits.find((c) => c.id === "c2")?.state).toBe("open");
    expect(l.balance).toBe(1);
  });
  it("onaylanmamış bildirim gün doğurmaz", () => {
    expect(settleCredits([credit("c1", "2026-10-04", "waiting")], [], NO_HOLIDAYS, "2026-10-05").balance).toBe(0);
  });
  it("pazardan önce alınan gün eşleşmez, müdüre sorulur", () => {
    const l = settleCredits([credit("c1", "2026-10-11")], [use("u1", "2026-10-06")], NO_HOLIDAYS, "2026-10-12");
    expect(l.unmatchedUses.map((u) => u.id)).toEqual(["u1"]);
    expect(l.balance).toBe(1);
  });
  it("resmi tatile denk gelen karşılık günü düşülmez", () => {
    const l = settleCredits([credit("c1", "2026-10-25")], [use("u1", "2026-10-29")], HOLIDAYS, "2026-10-30");
    expect(l.holidayUses).toHaveLength(1);
    expect(l.balance).toBe(1);
  });
  it("pazar: son 7 gün personele, son 5 gün müdür + yöneticiye; süre geçince kırmızı kalır", () => {
    const at = (today: string) => settleCredits([credit("c1", "2026-10-04")], [], NO_HOLIDAYS, today);
    expect(at("2026-10-20").credits[0]?.state).toBe("open");
    expect(at("2026-10-24").credits[0]?.state).toBe("remind");
    expect(creditAlerts(at("2026-10-24"))[0]?.audience).toEqual(["staff"]);
    expect(at("2026-10-27").credits[0]?.state).toBe("warn");
    expect(creditAlerts(at("2026-10-27"))[0]?.audience).toEqual(["staff", "manager", "admin"]);
    const late = at("2026-11-02");
    expect(late.credits[0]).toMatchObject({ state: "overdue", tone: "red" });
    expect(late.balance).toBe(1); // silinmez, bakiyede durur
  });
  it("bayram yumuşak takip: son günlerde yalnız hatırlatma, gecikince turuncu", () => {
    const at = (today: string) => settleCredits([credit("c1", "2026-05-01")], [], HOLIDAYS, today);
    expect(at("2026-05-28").credits[0]).toMatchObject({ kind: "holiday", state: "remind", tone: "yellow" });
    expect(at("2026-06-02").credits[0]).toMatchObject({ state: "overdue", tone: "amber" });
  });
});

describe("personel bildirimleri", () => {
  const base = { today: "2026-10-21", holidays: HOLIDAYS, alreadyClaimed: new Set<string>() };
  it("pazar ve bayram bildirilebilir, hafta içi bildirilemez", () => {
    expect(checkWorkedDayClaim({ ...base, date: "2026-10-18" })).toEqual({ ok: true, value: { kind: "sunday" } });
    expect(checkWorkedDayClaim({ ...base, date: "2026-05-01" })).toEqual({ ok: true, value: { kind: "holiday" } });
    expect(checkWorkedDayClaim({ ...base, date: "2026-10-20" }).ok).toBe(false);
  });
  it("gelecek gün, kapanmış ay ve aynı gün ikinci kez reddedilir", () => {
    expect(checkWorkedDayClaim({ ...base, date: "2026-10-25" }).ok).toBe(false);
    expect(checkWorkedDayClaim({ ...base, date: "2026-09-27", lockedBefore: "2026-10-01" }).ok).toBe(false);
    expect(checkWorkedDayClaim({ ...base, date: "2026-10-18", alreadyClaimed: new Set(["2026-10-18"]) }).ok).toBe(false);
  });
  const ot = { today: "2026-10-21", holidays: HOLIDAYS, reason: "opening_closing", minutes: 90 };
  it("hafta içi mesai yarım saat adımlarla kabul edilir", () => {
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20" })).toEqual({ ok: true, value: { minutes: 90, reason: "opening_closing", note: null, long: false, restDay: false } });
  });
  it("hafta içi 'molamı kullanamadım' herkes için geçerli; uydurma sebep reddedilir", () => {
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", reason: "missed_break" }).ok).toBe(true);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", reason: "uydurma" }).ok).toBe(false);
  });
  it("pazar / bayram: Mavi'de mesai yok; Derimod'da önce pazar bildirilir, sonra 8 saatin üstü yazılır", () => {
    expect(restDayOvertimeAllowed("Mavi")).toBe(false);
    expect(restDayOvertimeAllowed("Derimod")).toBe(true);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-18" }).ok).toBe(false);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-18", restDayAllowed: true }).ok).toBe(false);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-18", restDayAllowed: true, workedDayClaimed: true, reason: "missed_break" })).toMatchObject({ ok: true, value: { restDay: true } });
    expect(checkOvertimeClaim({ ...ot, date: "2026-05-01", restDayAllowed: true, workedDayClaimed: true })).toMatchObject({ ok: true, value: { restDay: true } });
  });
  it("başka sebep açıklama ister; süre yarım saat adımlı", () => {
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", reason: "other" }).ok).toBe(false);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", reason: "other", note: "Vitrin değişimi" }).ok).toBe(true);
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", minutes: 45 }).ok).toBe(false);
  });
  it("sabaha kadar sayım yazılabilir, müdüre 'uzun mesai' diye işaretlenir; yalnız yazım hatası reddedilir", () => {
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", reason: "stock_count", minutes: 480 })).toMatchObject({ ok: true, value: { long: true } });
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", minutes: 180, alreadyMinutes: 120 })).toMatchObject({ ok: true, value: { long: true } });
    expect(checkOvertimeClaim({ ...ot, date: "2026-10-20", minutes: 1020 }).ok).toBe(false);
  });
});


describe("izin talebi", () => {
  const base = { holidays: HOLIDAYS, lieuAvailable: 1, annualRemaining: 5, otherLeaves: [] as Array<{ start: string; end: string }> };
  it("pazar ve tatil düşülür; tek talepte gün sınırı yok", () => {
    // 19.10 Pzt – 31.10 Cmt: 13 gün, 1 pazar (25), 1 tatil (29) → 11
    expect(checkLeaveRequest({ ...base, kind: "annual", start: "2026-10-19", end: "2026-10-31" })).toMatchObject({ ok: true, value: { days: 11, negative: true } });
  });
  it("hak günü açık günden fazla istenemez; hiç yoksa önce bildirim istenir", () => {
    expect(checkLeaveRequest({ ...base, kind: "lieu", start: "2026-10-20", end: "2026-10-21" }).ok).toBe(false);
    const none = checkLeaveRequest({ ...base, lieuAvailable: 0, kind: "lieu", start: "2026-10-20", end: "2026-10-20" });
    expect(none.ok === false && none.error).toContain("Pazar / bayram çalıştım");
  });
  it("hak günü yarım alınamaz; yıllık izin yarım gün olur", () => {
    expect(checkLeaveRequest({ ...base, kind: "lieu", start: "2026-10-20", end: "2026-10-20", halfDay: true }).ok).toBe(false);
    expect(checkLeaveRequest({ ...base, kind: "annual", start: "2026-10-20", end: "2026-10-20", halfDay: true })).toMatchObject({ ok: true, value: { days: 0.5 } });
  });
  it("çakışan izin, yalnız pazar seçimi ve 2 günü aşan vefat reddedilir", () => {
    expect(checkLeaveRequest({ ...base, kind: "annual", start: "2026-10-20", end: "2026-10-20", otherLeaves: [{ start: "2026-10-19", end: "2026-10-21" }] }).ok).toBe(false);
    expect(checkLeaveRequest({ ...base, kind: "annual", start: "2026-10-18", end: "2026-10-18" }).ok).toBe(false);
    expect(checkLeaveRequest({ ...base, kind: "bereavement", start: "2026-10-20", end: "2026-10-22" }).ok).toBe(false);
  });
});

describe("kişi özeti", () => {
  const input: SummaryInput = {
    employeeId: "e1",
    hireDate: "2026-03-15",
    endDate: null,
    today: "2026-10-27",
    holidays: HOLIDAYS,
    opening: 0,
    workedDays: [
      { id: "w1", date: "2026-10-04", status: "approved" },
      { id: "w2", date: "2026-10-11", status: "approved" },
      { id: "w3", date: "2026-10-25", status: "waiting" },
    ],
    leaves: [
      { id: "l1", kind: "lieu", start: "2026-10-06", end: "2026-10-06", days: 1, status: "approved" },
      { id: "l2", kind: "annual", start: "2026-08-03", end: "2026-08-04", days: 2, status: "approved" },
      { id: "l3", kind: "sick", start: "2026-09-01", end: "2026-09-03", days: 3, status: "approved" },
      { id: "l4", kind: "lieu", start: "2026-10-28", end: "2026-10-28", days: 1, status: "waiting" },
    ],
    overtimes: [
      { date: "2026-10-20", minutes: 90, status: "approved" },
      { date: "2026-10-21", minutes: 60, status: "waiting" },
      { date: "2026-09-21", minutes: 60, status: "approved" },
    ],
  };
  it("yıllık izin: Mart–Eylül 7 ay = 8,17 gün, 2 kullanıldı; ekranda tam gün; hastalık ayrı", () => {
    const s = buildHrSummary(input);
    expect(s.annual).toMatchObject({ known: true, earned: 8.17, used: 2, remaining: 6.17, whole: 6, nextAccrualDate: "2026-10-31" });
    // 31.10'da 7,33 → ekranda 7: bir sonraki tam gün 31 Ekim
    expect(s.annual.nextWholeDayDate).toBe("2026-10-31");
    expect(s.sick.used).toBe(3);
  });
  it("tam gün aşağı yuvarlanır, yukarı asla: 5,17 → 5; 5,8 → 5; 6 → 6", () => {
    expect([5.17, 5.83, 6, 0.5, -0.5].map(wholeDays)).toEqual([5, 5, 6, 0, -1]);
    // 5,83 → 5; bir ay sonra 7 → sayı ancak o gün 6'ya çıkmaz, 7 olur
    const s = buildHrSummary({ ...input, hireDate: "2026-01-01", leaves: [{ id: "a", kind: "annual", start: "2026-02-02", end: "2026-02-06", days: 5.83, status: "approved" }], today: "2026-06-15" });
    expect(s.annual.remaining).toBe(0);
    expect(s.annual.whole).toBe(0);
    expect(s.annual.nextWholeDayDate).toBe("2026-06-30");
  });
  it("hak günü: 06.10 kullanımı 04.10'u kapatır; 11.10 son günlerde müdüre uyarı", () => {
    const s = buildHrSummary(input);
    expect(s.lieu.balance).toBe(1);
    expect(s.lieu.credits.find((c) => c.id === "w2")).toMatchObject({ state: "warn", tone: "red" });
    // 1 açık + 1 bekleyen bildirim − 1 bekleyen talep
    expect(s.lieu.available).toBe(1);
  });
  it("bu ayın mesaisi: onaylı ve bekleyen ayrı", () => {
    expect(buildHrSummary(input).overtimeMonth).toEqual({ approvedMinutes: 90, waitingMinutes: 60 });
  });
  it("işe giriş tarihi yoksa yıllık izin bilinmiyor", () => {
    expect(buildHrSummary({ ...input, hireDate: null }).annual.known).toBe(false);
  });
});

describe("kişi bilgileri", () => {
  it("müdür kimlik / adres / belge göremez; personel yalnız iletişim, adres, acil durum düzeltir", () => {
    const nid = PROFILE_FIELDS.find((x) => x.key === "national_id")!;
    const phone = PROFILE_FIELDS.find((x) => x.key === "personal_phone")!;
    expect(canSee(nid, "manager")).toBe(false);
    expect(canSee(phone, "manager")).toBe(true);
    expect(allowedUpdate({ personal_phone: " 0533 111 22 33 ", national_id: "123", address: "" }, "self")).toEqual({ personal_phone: "0533 111 22 33", address: null });
    expect(allowedUpdate({ national_id: "123" }, "manager")).toEqual({});
  });
  it("kıdem yazısı ve eksik bilgi yüzdesi", () => {
    expect(tenure("2025-08-04", "2026-10-22")).toBe("1 yıl 2 ay");
    expect(tenure("2026-10-10", "2026-10-22")).toBe("12 gün");
    expect(completeness({ personal_phone: "1", emergency_name: "x", emergency_phone: "2" }, { hireDate: "2025-01-01", hasBank: true })).toMatchObject({ percent: 63 });
  });
  it("çalışma izni bitişi ve doğum günü uyarısı", () => {
    const a = profileAlerts({ work_permit_expiry: "2026-11-01", birth_date: "1990-10-25" }, "2026-10-22");
    expect(a.map((x) => x.tone)).toEqual(["red", "info"]);
    expect(a[0]!.text).toContain("10 gün sonra");
  });
  it("çıkış ön hesabı: ay ortası ayrılan o ayın payını almaz; tam gün × net ÷ 26 + açık hak günü", () => {
    const p = exitPreview({ hireDate: "2020-01-01", endDate: "2026-10-15", opening: 0, annualUsed: 5, lieuOpen: 1, netSalary: 26000 });
    // Ocak–Eylül 9 ay = 10,5 gün − 5 = 5,5 → 5 tam gün; + 1 hak günü = 6 gün × 1.000
    expect(p).toMatchObject({ annualExact: 5.5, annualWhole: 5, payDays: 6, dayRate: 1000, amount: 6000 });
  });
});

describe("ajanda", () => {
  const people = [
    { id: "a", name: "Ayla", store: "Girne", storeId: "g", hireDate: "2025-10-28", birthDate: "1990-10-27", workPermitExpiry: "2026-11-01", passportExpiry: null },
    { id: "b", name: "Can", store: "Girne", storeId: "g", hireDate: "2026-01-05", birthDate: null },
  ];
  const leaves = [{ employeeId: "b", kind: "sick" as const, start: "2026-10-20", end: "2026-10-23", halfDay: false }];
  const base = { today: "2026-10-22", days: 14, people, leaves, holidays: [{ date: "2026-10-29", name: "Cumhuriyet Bayramı" }], credits: [{ employeeId: "a", date: "2026-10-18", deadline: "2026-10-31" }] };
  it("sahibi: izin türü, yıldönümü, doğum günü, bayram, hak günü son günü, belge; kadro durumu", () => {
    const f = buildFeed({ ...base, viewer: "admin" });
    const flat = f.days.flatMap((d) => d.items.map((x) => `${d.date}:${x.type}`));
    expect(flat).toEqual(["2026-10-22:leave", "2026-10-27:birthday", "2026-10-28:anniversary", "2026-10-29:holiday", "2026-10-31:lieu_deadline", "2026-11-01:document"]);
    expect(f.days[0]!.items[0]).toMatchObject({ kind: "sick", until: "2026-10-23" });
    expect(f.stores).toEqual([{ storeId: "g", store: "Girne", total: 2, away: 1 }]);
  });
  it("personel izin türünü, hak günü ve belge uyarılarını görmez", () => {
    const f = buildFeed({ ...base, viewer: "staff" });
    const types = f.days.flatMap((d) => d.items.map((x) => x.type));
    expect(types).not.toContain("lieu_deadline");
    expect(types).not.toContain("document");
    expect(f.days[0]!.items[0]).toMatchObject({ type: "leave", kind: null });
  });
});
