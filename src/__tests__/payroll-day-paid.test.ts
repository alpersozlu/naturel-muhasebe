import { describe, expect, it } from "vitest";
import { dayPaidBase, dayRate } from "@/server/services/payroll/rules";
import { lineUpdateSchema } from "@/lib/zod-schemas/payroll";

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
});
