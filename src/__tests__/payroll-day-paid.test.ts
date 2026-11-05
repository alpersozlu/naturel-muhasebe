import { describe, expect, it } from "vitest";
import { dayPaidBase, dayRate, workedDaysInPeriod } from "@/server/services/payroll/rules";
import { lineUpdateSchema } from "@/lib/zod-schemas/payroll";
import { computeLine, type LineInput } from "@/server/services/payroll/compute";

describe("günle ödenen personel", () => {
  it("gün ücreti kuruşa yuvarlanır, baz = gün × gün ücreti", () => {
    expect(dayRate(70893)).toBe(2726.65);
    // Neçirvan Ekim 2026: 14 gün
    expect(dayPaidBase(70893, 14)).toBe(38173.1);
    expect(dayPaidBase(70893, 0)).toBe(0);
  });

  it("satır güncellemesi gün sayısını alır, gönderilmezse dokunmaz", () => {
    const id = "f6fc255f-92eb-415e-91e8-1003854f552a";
    expect(lineUpdateSchema.parse({ id, worked_days: 14 }).worked_days).toBe(14);
    expect(lineUpdateSchema.parse({ id, worked_days: null }).worked_days).toBeNull();
    expect("worked_days" in lineUpdateSchema.parse({ id })).toBe(false);
    expect(() => lineUpdateSchema.parse({ id, worked_days: 32 })).toThrow();
  });

  it("gün ücreti maaş değildir: mesai gibi Ödeme 2'de ödenir", () => {
    const line: LineInput = {
      base_salary: 0, commission_profile: "none", overtime_hours: 0, day_pay: dayPaidBase(70893, 14),
      own_revenue_nd: null, own_revenue_denim: null, own_revenue: null, own_target: null,
      achievement_accepted: null, commission_override: null, commission_note: null,
      perfume_units: 0, garment_units: 0, top_seller: false, extra_premium: 0, extra_premium_note: null,
      paid_month_early: false, status: "active",
    };
    const c = computeLine(line, { revenue: null, target: null }, []);
    expect(c.day_pay_amount).toBe(38173.1);
    expect(c.overtime_amount).toBe(38173.1);
    expect(c.payment1_due).toBe(0);
    expect(c.payment2_due).toBe(38173.1);
  });

  it("kısmi ay: giriş/çıkış aralığında pazarsız gün sayısı", () => {
    expect(workedDaysInPeriod(2026, 10, "2026-10-05", null)).toBe(24); // Semanur
    expect(workedDaysInPeriod(2026, 10, "2026-10-12", null)).toBe(18); // Büşra
    expect(workedDaysInPeriod(2026, 10, null, "2026-10-23")).toBe(20); // Ali: 1–23, pazar 4/11/18 hariç
    expect(workedDaysInPeriod(2026, 10, "2026-09-01", null)).toBeNull(); // tam ay
    expect(workedDaysInPeriod(2026, 10, null, null)).toBeNull();
    expect(dayPaidBase(70893, 24)).toBe(65439.6);
  });
});
