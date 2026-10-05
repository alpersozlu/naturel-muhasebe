import { describe, expect, it } from "vitest";
import { computeLine, type LineInput } from "@/server/services/payroll/compute";
import { isOvertimeOnlyPosition } from "@/server/services/payroll/rules";

/**
 * Depo personeli (sahibi, 05.10.2026): prim / komisyon yok. Ödeme 2'de eklenen
 * tek kalem ek mesaidir; kesintiler (fiyat farkı gibi) ondan düşülür.
 */
const depo = (over: Partial<LineInput> = {}): LineInput => ({
  base_salary: 68000.31,
  commission_profile: "none",
  overtime_hours: 0,
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
  ...over,
});
const STORE = { revenue: 4_000_000, target: 4_000_000 };
const entry = (kind: "payment" | "deduction", amount: number, category: string) => ({
  id: `${kind}-${amount}`,
  kind,
  amount,
  category,
  note: "test",
  entry_date: "2026-10-02",
  voided_at: null,
  batch: null,
});

describe("depo personeli — yalnız mesai eklenir, kesinti düşülür", () => {
  it("görev adından tanınır; Lojistik ve satış görevleri bu kurala girmez", () => {
    for (const p of ["Depo", "depo", "Depocu", "Depo Sorumlusu"]) expect(isOvertimeOnlyPosition(p)).toBe(true);
    for (const p of ["Lojistik", "Satış Asistanı", "Kasiyer", "Mağaza Müdürü", "", null, undefined]) expect(isOvertimeOnlyPosition(p)).toBe(false);
  });

  it("mağaza hedefi tutsa da komisyon yok; Ödeme 2 = mesai (net baz ÷ 208 × saat)", () => {
    const paid = [entry("payment", 68000.31, "payment1")];
    const c = computeLine(depo({ overtime_hours: 5 }), STORE, paid as never);
    expect(c.commission.final).toBe(0);
    expect(c.overtime_amount).toBe(1634.62); // 68.000,31 ÷ 208 × 5
    expect(c.extras_total).toBe(1634.62);
    expect(c.payment2_due).toBe(1634.62);
  });

  it("fiyat farkı mesaiden düşülür", () => {
    const e = [entry("payment", 68000.31, "payment1"), entry("deduction", 600, "price_difference")];
    const c = computeLine(depo({ overtime_hours: 5 }), STORE, e as never);
    expect(c.deductions_total).toBe(600);
    expect(c.payment2_due).toBe(1034.62);
    expect(c.net_remaining).toBe(1034.62);
  });

  it("kesinti mesaiyi aşarsa Ödeme 2 sıfırdır ve aşan kısım açıkta kalır (sonraki aya devredilmeli)", () => {
    const e = [entry("payment", 68000.31, "payment1"), entry("deduction", 3000, "price_difference")];
    const c = computeLine(depo({ overtime_hours: 5 }), STORE, e as never);
    expect(c.payment2_due).toBe(0);
    expect(c.net_remaining).toBe(-1365.38);
    expect(c.flags.some((f) => f.code === "overpaid")).toBe(true);
  });
});
