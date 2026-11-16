import { describe, expect, it } from "vitest";
import { partialRange, prorateTarget, usesStoreBasis } from "@/server/services/payroll/partial-period";
import { bracketFor, MAVI_MUDUR_TABLE, MAVI_VICE_FACTOR } from "@/server/services/payroll/rules";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("kısmi ay — mağaza cirosuna bakan profiller (sahibi, 16.11.2026)", () => {
  it("yalnız müdür / müdür yrd. profilleri", () => {
    for (const p of ["mavi_mudur", "mavi_vice", "deri_mudur"]) expect(usesStoreBasis(p)).toBe(true);
    for (const p of ["mavi_asistan", "deri_asistan", "none"]) expect(usesStoreBasis(p)).toBe(false);
  });

  it("tam ay çalışanda kural devreye girmez", () => {
    expect(partialRange(2026, 10, null, null)).toBeNull();
    expect(partialRange(2026, 10, d("2026-09-01"), null)).toBeNull();
    expect(partialRange(2026, 10, d("2026-10-01"), d("2026-10-31"))).toBeNull();
    expect(partialRange(2026, 10, d("2026-05-10"), d("2027-01-01"))).toBeNull();
  });

  it("ay içinde başlayan: aralık ve gün sayısı", () => {
    const r = partialRange(2026, 10, d("2026-10-09"), null)!;
    expect(r).toMatchObject({ from: "2026-10-09", to: "2026-10-31", days: 23, month_days: 31 });
  });

  it("ay içinde ayrılan ve ay içinde girip çıkan", () => {
    expect(partialRange(2026, 10, null, d("2026-10-20"))!).toMatchObject({ from: "2026-10-01", to: "2026-10-20", days: 20 });
    const r = partialRange(2026, 10, d("2026-10-09"), d("2026-10-25"))!;
    expect(r).toMatchObject({ from: "2026-10-09", to: "2026-10-25", days: 17, month_days: 31 });
  });

  it("hedef aynı oranda küçülür", () => {
    const r = partialRange(2026, 10, d("2026-10-09"), d("2026-10-25"))!;
    expect(prorateTarget(5600000, r)).toBe(3070967.74);
    expect(prorateTarget(null, r)).toBeNull();
    expect(prorateTarget(0, r)).toBe(0);
  });

  it("Sedanur Çiçek 09–25 Ekim: 7.412,01 ₺ (gerçek vaka)", () => {
    const r = partialRange(2026, 10, d("2026-10-09"), d("2026-10-25"))!;
    const target = prorateTarget(5600000, r)!;
    const revenue = 3294224.91; // SAP Performans ekranı ve DealerDailyRep toplamı
    const achievement = revenue / target;
    expect(achievement).toBeGreaterThan(1.05);
    const rate = bracketFor(MAVI_MUDUR_TABLE, achievement).rate * MAVI_VICE_FACTOR;
    expect(rate).toBeCloseTo(0.00225, 6);
    expect(Math.round(revenue * rate * 100) / 100).toBe(7412.01);
  });

  it("aynı kişi ayın tamamında çalışsaydı oran düşerdi (karşılaştırma)", () => {
    const a = 5836338.53 / 5600000;
    const rate = bracketFor(MAVI_MUDUR_TABLE, a).rate * MAVI_VICE_FACTOR;
    expect(Math.round(5836338.53 * rate * 100) / 100).toBe(10943.13);
  });

  it("şubat gibi kısa ayda da gün oranı doğru", () => {
    const r = partialRange(2026, 2, d("2026-02-15"), null)!;
    expect(r).toMatchObject({ from: "2026-02-15", to: "2026-02-28", days: 14, month_days: 28 });
    expect(prorateTarget(2800000, r)).toBe(1400000);
  });
});
