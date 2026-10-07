import { describe, expect, it } from "vitest";
import { computeLine, type EntryLike, type LineInput } from "@/server/services/payroll/compute";

// "Maaşlar (Ödeme 2)" kartı: kişi Ödeme 2 kapsamında mı, kapandı mı, ne ödendi.
const base: LineInput = {
  base_salary: 70_893,
  commission_profile: "none",
  overtime_hours: 10,
  own_revenue_nd: null,
  own_revenue_denim: null,
  own_revenue: null,
  own_target: null,
  achievement_accepted: null,
  commission_override: null,
  commission_note: null,
  perfume_units: 0,
  garment_units: 0,
  top_seller: false,
  extra_premium: 0,
  extra_premium_note: null,
  paid_month_early: false,
  status: "active",
};
const store = { revenue: null, target: null };
const pay = (id: string, category: string, amount: number, batchStatus: "sent" | "prepared" | "void" = "sent"): EntryLike => ({
  id, kind: "payment", category, channel: "cash", entry_date: "2026-10-05", amount, note: null, reference: null, voided_at: null,
  batch: { id: "b", status: batchStatus, title: "Ödeme 2 nakit" },
});

describe("Ödeme 2 kapsamı ve kapanışı", () => {
  it("maaşı ödenmiş, mesaisi olan kişi kapsamda ve bekliyor", () => {
    const c = computeLine(base, store, [pay("p1", "payment1", 70_893)]);
    expect(c.base_paid).toBe(true);
    expect(c.payment2_due).toBeCloseTo((70_893 / 208) * 10, 2);
    expect(c.payment2_in_scope).toBe(true);
    expect(c.payment2_settled).toBe(false);
    expect(c.payment2_paid).toBe(0);
  });
  it("Ödeme 2 nakit ödenince kapanır; ödenen tutar yalnız payment2 kayıtlarıdır", () => {
    const due = Math.round((70_893 / 208) * 10 * 100) / 100;
    const c = computeLine(base, store, [pay("p1", "payment1", 70_893), pay("p2", "payment2", due)]);
    expect(c.payment2_paid).toBeCloseTo(due, 2);
    expect(c.payment2_due).toBeCloseTo(0, 2);
    expect(c.payment2_in_scope).toBe(true);
    expect(c.payment2_settled).toBe(true);
  });
  it("hazırlanıp gönderilmemiş talimat ödenmiş sayılmaz", () => {
    const due = Math.round((70_893 / 208) * 10 * 100) / 100;
    const c = computeLine(base, store, [pay("p1", "payment1", 70_893), pay("p2", "payment2", due, "prepared")]);
    expect(c.payment2_paid).toBe(0);
    expect(c.payment2_settled).toBe(false);
  });
  it("mesai, komisyon, prim olmayan kişi kapsam dışı", () => {
    const c = computeLine({ ...base, overtime_hours: 0 }, store, [pay("p1", "payment1", 70_893)]);
    expect(c.payment2_in_scope).toBe(false);
    expect(c.payment2_settled).toBe(false);
  });
  it("Yaşar Kemal örneği: kesinti maaştan karşılandıysa Ödeme 2'den düşmez", () => {
    // baz 68.000,01 · avans 15.000 · kesinti 38.409,70 · Ödeme 1 14.590,31 → maaş tam kapandı
    const inp: LineInput = { ...base, base_salary: 68_000.01, overtime_hours: 8 };
    const adv: EntryLike = { id: "a", kind: "advance", category: null, channel: "garanti", entry_date: "2026-09-16", amount: 15_000, note: null, reference: null, voided_at: null, batch: null };
    const ded: EntryLike = { id: "d", kind: "deduction", category: "double_payment", channel: null, entry_date: "2026-09-30", amount: 38_409.7, note: "x", reference: null, voided_at: null, batch: null };
    const c = computeLine(inp, store, [adv, ded, pay("p1", "payment1", 14_590.31)]);
    expect(c.base_paid).toBe(true);
    expect(c.deductions_from_salary).toBeCloseTo(38_409.7, 2);
    expect(c.deductions_from_extras).toBe(0);
    expect(c.payment2_due).toBeCloseTo(c.overtime_amount, 2);
  });
  it("Oğuzhan örneği: maaşın karşılayamadığı kesinti Ödeme 2'den düşer", () => {
    // baz 70.893 · kesinti 42.539,88 · avans 30.000 · Ödeme 1 22.893 → maaştan 18.000, ekstradan 24.539,88
    const inp: LineInput = { ...base, overtime_hours: 24 };
    const adv: EntryLike = { id: "a", kind: "advance", category: null, channel: "cash", entry_date: "2026-09-16", amount: 30_000, note: null, reference: null, voided_at: null, batch: null };
    const ded: EntryLike = { id: "d", kind: "deduction", category: "other", channel: null, entry_date: "2026-09-30", amount: 42_539.88, note: "x", reference: null, voided_at: null, batch: null };
    const c = computeLine(inp, store, [adv, ded, pay("p1", "payment1", 22_893)]);
    expect(c.deductions_from_salary).toBeCloseTo(18_000, 2);
    expect(c.deductions_from_extras).toBeCloseTo(24_539.88, 2);
    expect(c.deductions_from_salary + c.deductions_from_extras).toBeCloseTo(c.deductions_total, 2);
  });
  it("Ekin Doğan örneği: maaş ödenmeden Ödeme 2 ödenirse Ödeme 2 kapanır, maaş bakiyesi değişmez", () => {
    // baz 70.893 · avans 20.000 · ekstra 13.140,17 (ek prim) · Ödeme 2 nakit 13.140,17 ödendi
    const inp: LineInput = { ...base, overtime_hours: 0, extra_premium: 13_140.17, extra_premium_note: "çıkış" };
    const adv: EntryLike = { id: "a", kind: "advance", category: null, channel: "cash", entry_date: "2026-09-16", amount: 20_000, note: null, reference: null, voided_at: null, batch: null };
    const c = computeLine(inp, store, [adv, pay("p2", "payment2", 13_140.17)]);
    expect(c.payment2_paid).toBeCloseTo(13_140.17, 2);
    expect(c.payment2_due).toBeCloseTo(0, 2);
    expect(c.payment2_settled).toBe(true);
    expect(c.payment1_due).toBeCloseTo(50_893, 2); // 70.893 − 20.000: maaş bakiyesi Ödeme 2'den etkilenmez
    expect(c.net_remaining).toBeCloseTo(50_893, 2);
    expect(c.base_paid).toBe(false);
  });
  it("kesinti ekstrayı yutunca ödenecek yok → kapsam dışı (devir ekranı ayrı)", () => {
    const ded: EntryLike = { id: "d", kind: "deduction", category: "other", channel: null, entry_date: "2026-09-30", amount: 20_000, note: "x", reference: null, voided_at: null, batch: null };
    const c = computeLine(base, store, [pay("p1", "payment1", 70_893), ded]);
    expect(c.payment2_due).toBe(0);
    expect(c.payment2_in_scope).toBe(false);
  });
});
