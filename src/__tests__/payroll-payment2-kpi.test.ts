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
  it("kesinti ekstrayı yutunca ödenecek yok → kapsam dışı (devir ekranı ayrı)", () => {
    const ded: EntryLike = { id: "d", kind: "deduction", category: "other", channel: null, entry_date: "2026-09-30", amount: 20_000, note: "x", reference: null, voided_at: null, batch: null };
    const c = computeLine(base, store, [pay("p1", "payment1", 70_893), ded]);
    expect(c.payment2_due).toBe(0);
    expect(c.payment2_in_scope).toBe(false);
  });
});
