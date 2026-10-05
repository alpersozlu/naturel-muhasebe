import { describe, expect, it } from "vitest";
import {
  buildSundayAudit,
  classifyLeave,
  splitOvertime,
  sundaysOfMonth,
  type AuditLeave,
  type AuditOvertime,
} from "@/server/services/kolayik/sunday-audit";

/**
 * Pazar çalışması ↔ hak günü denetimi. Örnekler Eylül 2026'nın gerçek Kolay İK
 * kayıtlarındaki kalıplardan alındı (adlar değiştirildi).
 */
let seq = 0;
const ot = (personId: string, date: string, minutes: number, extra: Partial<AuditOvertime> = {}): AuditOvertime => ({
  id: `o${++seq}`,
  personId,
  date,
  minutes,
  status: "approved",
  description: "Pazar mesaisi",
  createdAt: date,
  ...extra,
});
const lv = (personId: string, start: string, comment: string | null, extra: Partial<AuditLeave> = {}): AuditLeave => ({
  id: `l${++seq}`,
  personId,
  start,
  end: start,
  days: 1,
  status: "approved",
  type: "Yıllık İzin",
  comment,
  ...extra,
});
const run = (overtime: AuditOvertime[], leaves: AuditLeave[], today = "2026-10-05") =>
  buildSundayAudit({ year: 2026, month: 9, today, personIds: ["p"], overtime, leaves }).people[0]!;

describe("pazar çalışması ↔ hak günü", () => {
  it("Eylül 2026 pazarları", () => {
    expect(sundaysOfMonth(2026, 9)).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
  });

  it("8 saat hak günüdür, üstü ücrettir; hafta içi mesai tamamen ücrettir", () => {
    expect(splitOvertime({ date: "2026-09-06", minutes: 480, description: "Pazar mesaisi" })).toEqual({ credit_day: true, paid_minutes: 0, rest_day: true });
    // sahibi: "10 saat yazarsa 2 saat ek mesai olarak eklenecek"
    expect(splitOvertime({ date: "2026-09-06", minutes: 600, description: "Molasız pazar mesaisi" })).toEqual({ credit_day: true, paid_minutes: 120, rest_day: true });
    // yalnız ek saat girilmiş pazar ("kaç saat yaptıysa ek mesai onu yazmış"): girilen dakikanın tamamı ücrettir
    expect(splitOvertime({ date: "2026-09-13", minutes: 180, description: "1.5 x2 ek Pazar" })).toEqual({ credit_day: false, paid_minutes: 180, rest_day: true });
    expect(splitOvertime({ date: "2026-09-13", minutes: 120, description: "Pazar ek mesai" })).toEqual({ credit_day: false, paid_minutes: 120, rest_day: true });
    expect(splitOvertime({ date: "2026-09-09", minutes: 120, description: "2 saat fazla mesai" })).toEqual({ credit_day: false, paid_minutes: 120, rest_day: false });
    // resmî tatil hafta içine denk gelse de hak günüdür
    expect(splitOvertime({ date: "2026-08-25", minutes: 480, description: "Resmi tatil" })).toEqual({ credit_day: true, paid_minutes: 0, rest_day: true });
    // hafta içi 8 saat, tatil notu yok: hak günü sayılmaz
    expect(splitOvertime({ date: "2026-10-02", minutes: 480, description: null })).toEqual({ credit_day: false, paid_minutes: 480, rest_day: false });
  });

  it("izin açıklamasından tür ve hangi pazarın karşılığı olduğu okunur", () => {
    const c = (comment: string, start = "2026-09-15", type = "Yıllık İzin") => classifyLeave({ start, comment, type });
    expect(c("Pazar mesai izni").cls).toBe("inlieu");
    expect(c("HaftaLık ızın").cls).toBe("inlieu");
    expect(c("Yillik izin").cls).toBe("annual");
    expect(c("İzin kullanmak istiyorum").cls).toBe("unknown");
    expect(c("Raporlu hastalık izini").cls).toBe("sick");
    expect(c("x", "2026-09-10", "Hastalık İzni").cls).toBe("sick");
    expect(c("Giriş 10:30\nÇıkış 20:00\n1 buçuk saat mola kullandım.").cls).toBe("worklog");
    expect(c("13.09.2026 pazar günü çalıştığım için \n16.09.2026 çarşamba günü izin talep ediyorum")).toEqual({ cls: "inlieu", refs: ["2026-09-13"] });
    expect(c("6 sındaki pazar mesaisinin karşılığındaki izin .", "2026-09-14")).toEqual({ cls: "inlieu", refs: ["2026-09-06"] });
    // pazar + yıllık birlikte geçiyorsa karşılık günüdür (ilk gün)
    expect(c("Haftalık pazar karşılığı izin ve yıllık izinden kullanılan 1 gün").cls).toBe("inlieu");
  });

  it("her pazarın karşılığı izleyen hafta alınmışsa hepsi kullanılmış sayılır", () => {
    const p = run(
      [ot("p", "2026-09-06", 480), ot("p", "2026-09-13", 480), ot("p", "2026-09-20", 480), ot("p", "2026-09-27", 480)],
      [lv("p", "2026-09-08", "Pazar calisma izni"), lv("p", "2026-09-15", "Pazar calisma izni"), lv("p", "2026-09-22", "Pazar calisma izni"), lv("p", "2026-09-28", "Pazar calisma izni")]
    );
    expect(p.counts).toEqual({ worked: 4, with_8h: 4, used: 4, waiting: 0, pending: 0, unused: 0 });
    expect(p.sundays.map((s) => s.rest?.date)).toEqual(["2026-09-08", "2026-09-15", "2026-09-22", "2026-09-28"]);
    expect(p.issues).toEqual([]);
  });

  it("karşılık günü en yakın önceki pazara bağlanır; arada kalan pazar kullanılmamış çıkar", () => {
    const p = run(
      [ot("p", "2026-09-06", 480), ot("p", "2026-09-13", 480), ot("p", "2026-09-27", 480)],
      [lv("p", "2026-09-11", "Pazar iznimi kullanmak istiyorum"), lv("p", "2026-09-30", "Pazar iznimi kullanmak istiyorum")]
    );
    expect(p.sundays.map((s) => s.state)).toEqual(["used", "unused", "used"]);
    expect(p.issues).toEqual(["1 pazarın karşılığı kullanılmamış (13.09)"]);
  });

  it("hiç izin girmeyen: çalışılan her pazar birikir", () => {
    const p = run([ot("p", "2026-09-06", 480), ot("p", "2026-09-13", 480), ot("p", "2026-09-20", 480)], []);
    expect(p.counts.unused).toBe(3);
  });

  it("izleyen hafta bitmediyse “kullanılmadı” denmez", () => {
    const o = [ot("p", "2026-09-27", 480)];
    expect(run(o, [], "2026-10-02").sundays[0]!.state).toBe("pending");
    expect(run(o, [], "2026-10-03").sundays[0]!.state).toBe("pending"); // cumartesi: son gün
    expect(run(o, [], "2026-10-04").sundays[0]!.state).toBe("unused");
  });

  it("onay bekleyen izin “kullanıldı” değildir — bakiyeden henüz düşmedi", () => {
    const p = run([ot("p", "2026-09-27", 480)], [lv("p", "2026-09-29", "Pazar izni", { status: "waiting" })]);
    expect(p.sundays[0]!.state).toBe("waiting");
    expect(p.counts).toMatchObject({ used: 0, waiting: 1, unused: 0 });
  });

  it("açıklaması “yıllık izin” diyen gün karşılık sayılmaz, ama notta görünür", () => {
    const p = run([ot("p", "2026-09-06", 600)], [lv("p", "2026-09-15", "Yıllık izin")]);
    expect(p.sundays[0]!.state).toBe("unused");
    expect(p.sundays[0]!.paid_minutes).toBe(120);
    expect(p.sundays[0]!.notes.join(" ")).toContain("15.09 tarihinde tek günlük “yıllık izin” var");
  });

  it("açıklaması bir şey söylemeyen tek günlük izin “muhtemel” eşleşmedir", () => {
    const p = run([ot("p", "2026-09-13", 660)], [lv("p", "2026-09-14", "İzin kullanmak istiyorum")]);
    expect(p.sundays[0]!.state).toBe("used");
    expect(p.sundays[0]!.rest!.confidence).toBe("probable");
  });

  it("ardından çok günlük yıllık izne çıkılmışsa karşılık günü ayrıca gösterilmemiştir", () => {
    const p = run([ot("p", "2026-09-06", 480)], [lv("p", "2026-09-07", "Yıllık İzin", { end: "2026-09-12", days: 6 })]);
    expect(p.sundays[0]!.state).toBe("unused");
    expect(p.sundays[0]!.notes.join(" ")).toContain("07.09–12.09 6 günlük izin var");
  });

  it("yalnız ek saat girilmiş pazar: çalışılmış sayılır, yazılan saat ücrettir, kayıt düzeltilmelidir", () => {
    // Selbi H., Eylül 2026 — sahibi: "kaç saat yaptıysa ek mesai onu yazmış, onları düzeltebiliriz"
    const p = run([ot("p", "2026-09-13", 120, { description: "Pazar ek mesai", createdAt: "2026-10-03" })], [lv("p", "2026-09-16", "Haftalık ızın")]);
    expect(p.counts).toMatchObject({ worked: 1, with_8h: 0, used: 1, unused: 0 });
    expect(p.sundays[0]!.paid_minutes).toBe(120);
    expect(p.sundays[0]!.state).toBe("used");
    expect(p.sundays[0]!.entered_after_days).toBe(20);
    expect(p.sundays[0]!.notes[0]).toBe("Yalnız ek mesai yazılmış (2 saat, ücrete girer) — pazarın 8 saati ayrıca girilmemiş; kayıt 8 + ek saat olarak düzeltilmeli");
    expect(p.issues).toEqual(["1 pazarda yalnız ek mesai yazılmış, 8 saat girilmemiş (13.09)"]);
  });

  it("pazar çalışması izin olarak girilmişse yakalanır (bakiyeden yanlışlıkla 1 gün düşer)", () => {
    const p = run(
      [ot("p", "2026-09-06", 480)],
      [
        lv("p", "2026-09-08", "06.09.2026 pazar tarihinde çalıştığım için izin talep etmekteyim."),
        lv("p", "2026-09-13", "Giriş 10:30\nÇıkış 20:00\n1 buçuk saat mola kullandım."),
        lv("p", "2026-09-15", "13.09.2026 pazar günü çalıştığım için izin talep etmekteyim."),
      ]
    );
    expect(p.sundays.map((s) => [s.date, s.source, s.state])).toEqual([
      ["2026-09-06", "overtime", "used"],
      ["2026-09-13", "misfiled_leave", "used"],
    ]);
    expect(p.issues).toEqual(["13.09 pazar çalışması izin olarak girilmiş (yanlış)"]);
  });

  it("“haftalık izin” alınmış ama önünde çalışılmış pazar kaydı yoksa bildirilir; ay başındaki izin önceki aya aittir", () => {
    const p = run(
      [ot("p", "2026-08-30", 480), ot("p", "2026-09-13", 480)],
      [
        lv("p", "2026-09-01", "Haftalık izin"), // 30.08 pazarının karşılığı — Eylül'ün sorunu değil
        lv("p", "2026-09-09", "Haftalık izin"), // 06.09 için mesai kaydı yok
        lv("p", "2026-09-16", "Haftalık izin"),
      ]
    );
    expect(p.sundays.map((s) => [s.date, s.rest?.date])).toEqual([["2026-09-13", "2026-09-16"]]);
    expect(p.orphan_rests.map((o) => o.date)).toEqual(["2026-09-09"]);
  });

  it("hastalık izni “Yıllık İzin” türünde girilmişse bildirilir, karşılık günü sayılmaz", () => {
    const p = run([ot("p", "2026-09-06", 480)], [lv("p", "2026-09-09", "Hastalık izini"), lv("p", "2026-09-11", "Hastalik izni", { type: "Hastalık İzni" })]);
    expect(p.sundays[0]!.state).toBe("unused");
    expect(p.issues).toContain("1 gün hastalık izni “Yıllık İzin” türünde girilmiş — yıllık izinden düşmüş (09.09)");
  });

  it("reddedilen mesai kaydı çalışma sayılmaz; iki günlük “pazar karşılığı” iznin yalnız ilk günü karşılıktır", () => {
    const p = run(
      [ot("p", "2026-09-06", 600, { status: "rejected" }), ot("p", "2026-09-13", 480)],
      [lv("p", "2026-09-16", "13.09.2026 Pazar günü çalıştığım için\n17.09.2026 ek izin", { end: "2026-09-17", days: 2 })]
    );
    expect(p.sundays.map((s) => s.date)).toEqual(["2026-09-13"]);
    expect(p.sundays[0]!.rest!.confidence).toBe("explicit");
    expect(p.sundays[0]!.notes.join(" ")).toContain("İzin 2 gün");
  });
});
