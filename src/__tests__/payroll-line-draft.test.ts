import { describe, expect, it } from "vitest";
import { computeLine, type EntryLike } from "@/server/services/payroll/compute";
import type { ComputedLine } from "@/server/services/payroll/period";
import { draftBase, draftFromLine, draftPayload, draftToInput, sameDraft } from "@/components/payroll/v2/line-draft";

const store = { revenue: 5_836_338.53, target: 5_600_000 };

function line(over: Partial<ComputedLine> = {}, entries: EntryLike[] = []): ComputedLine {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    period_id: "p",
    employee_id: "e",
    store_id: "s",
    store_name: "Mavi Girne",
    brand_name: "Mavi Jeans",
    full_name: "Deneme Kişi",
    position: "Satış Asistanı",
    commission_profile: "mavi_asistan" as const,
    pay_method: "garanti" as const,
    bank_account_name: null,
    has_bank_details: true,
    employee_status: "active" as const,
    start_date: null,
    end_date: null,
    paid_month_early: false,
    perfume_eligible: false,
    garment_eligible: false,
    employee_notes: null,
    paid_by_day: false,
    worked_days: null,
    card_base_salary: 61677,
    base_salary: 61677,
    overtime_hours: 0,
    overtime_note: null,
    own_revenue_nd: 1_179_545.96,
    own_revenue_denim: 671_431.9,
    own_revenue: null,
    own_target: 1_505_376.34,
    achievement_accepted: null,
    commission_override: null,
    commission_note: null,
    perfume_units: 0,
    garment_units: 0,
    top_seller: false,
    extra_premium: 2372.19,
    extra_premium_note: "Rapor iadesi",
    note: "satır notu",
    updated_at: "2026-11-09T00:00:00.000Z",
    ...over,
  };
  const calc = computeLine(
    {
      base_salary: base.base_salary,
      commission_profile: base.commission_profile,
      overtime_hours: base.overtime_hours,
      day_pay: 0,
      own_revenue_nd: base.own_revenue_nd,
      own_revenue_denim: base.own_revenue_denim,
      own_revenue: base.own_revenue,
      own_target: base.own_target,
      achievement_accepted: base.achievement_accepted,
      commission_override: base.commission_override,
      commission_note: base.commission_note,
      perfume_units: base.perfume_units,
      garment_units: base.garment_units,
      top_seller: base.top_seller,
      extra_premium: base.extra_premium,
      extra_premium_note: base.extra_premium_note,
      paid_month_early: base.paid_month_early,
      status: base.employee_status,
    },
    store,
    entries
  );
  return { ...base, calc } as ComputedLine;
}

const changed = (p: Record<string, unknown>) => Object.keys(p).filter((k) => k !== "id" && p[k] !== undefined);

describe("kişi paneli taslağı (line-draft)", () => {
  it("dokunulmamış taslak sunucudaki hesabın aynısını verir ve hiçbir alan göndermez", () => {
    const l = line();
    const d = draftFromLine(l);
    const c = computeLine(draftToInput(l, d), store, l.calc.entries);
    expect(c.gross).toBe(l.calc.gross);
    expect(c.commission.final).toBe(l.calc.commission.final);
    expect(c.payment2_due).toBe(l.calc.payment2_due);
    expect(changed(draftPayload(l, d))).toEqual([]);
    expect(sameDraft(d, draftFromLine(l))).toBe(true);
  });

  it("yalnız değişen alan gider — hedef değişince notlar ve ek prim silinmez (02.11.2026 vakası)", () => {
    const l = line();
    const p = draftPayload(l, { ...draftFromLine(l), own_target: 1_600_000 });
    expect(changed(p)).toEqual(["own_target"]);
    expect(p.own_target).toBe(1_600_000);
    expect(p.note).toBeUndefined();
    expect(p.extra_premium_note).toBeUndefined();
  });

  it("mesai saati ve notu birlikte gider (Kolay İK 'Uygula')", () => {
    const l = line();
    const p = draftPayload(l, { ...draftFromLine(l), overtime_hours: "6", overtime_note: "pazar 8 saat üstü" });
    expect(changed(p).sort()).toEqual(["overtime_hours", "overtime_note"]);
    expect(p.overtime_hours).toBe(6);
  });

  it("kısmi ay: gün girilince baz gün × (kart bazı ÷ 26); baz ayrıca gönderilmez, sunucu kurar", () => {
    const l = line();
    const d = { ...draftFromLine(l), worked_days: "24" };
    expect(draftBase(l, d)).toBe(56932.56); // 2.372,19 × 24
    const p = draftPayload(l, d);
    expect(p.worked_days).toBe(24);
    expect(p.base_salary).toBeUndefined();
  });

  it("kısmi ay silinince tam kart bazına döner", () => {
    const l = line({ worked_days: 24, base_salary: 56932.56 });
    const d = { ...draftFromLine(l), worked_days: "" };
    expect(draftBase(l, d)).toBe(61677);
    expect(draftPayload(l, d).worked_days).toBeNull();
  });

  it("gün değişmeden elle değiştirilen baz gider", () => {
    const l = line();
    const p = draftPayload(l, { ...draftFromLine(l), base_salary: 65000 });
    expect(changed(p)).toEqual(["base_salary"]);
    expect(p.base_salary).toBe(65000);
  });

  it("günle ödenen: gün ücreti Ödeme 2'ye girer, baz 0 kalır", () => {
    const l = line({ paid_by_day: true, base_salary: 0, worked_days: null, card_base_salary: 70893, commission_profile: "none", own_revenue_nd: null, own_revenue_denim: null, own_target: null, extra_premium: 0, extra_premium_note: null });
    const d = { ...draftFromLine(l), worked_days: "8" };
    const c = computeLine(draftToInput(l, d), store, []);
    expect(draftBase(l, d)).toBe(0);
    expect(c.day_pay_amount).toBe(21813.2); // 2.726,65 × 8
    expect(c.payment2_due).toBe(21813.2);
  });

  it("ÖZEL başarı yüzde olarak yazılır, oran olarak gider; boşaltılınca null", () => {
    const l = line();
    expect(draftPayload(l, { ...draftFromLine(l), achievement_accepted: "100" }).achievement_accepted).toBe(1);
    const l2 = line({ achievement_accepted: 1 });
    expect(draftFromLine(l2).achievement_accepted).toBe("100");
    expect(draftPayload(l2, { ...draftFromLine(l2), achievement_accepted: "" }).achievement_accepted).toBeNull();
  });

  it("Derimod asistanında Mavi alanları gönderilmez", () => {
    const l = line({ commission_profile: "deri_asistan", own_revenue_nd: null, own_revenue_denim: null, own_revenue: 900_000, own_target: 1_000_000 });
    const p = draftPayload(l, { ...draftFromLine(l), own_revenue: 950_000, own_revenue_nd: 5 });
    expect(changed(p)).toEqual(["own_revenue"]);
  });
});
