import { describe, expect, it } from "vitest";
import { isOptimumBank, optimumShareOf } from "@/lib/optimum-share";

// Sahibi 29.10.2026: Optimum cihazı (Yapı Kredi + Koopbank) toplamı diğer bankalardan fazla olmalı.
describe("Optimum payı", () => {
  it("Yapı Kredi ve Koopbank Optimum cihazıdır, diğerleri değildir", () => {
    expect(isOptimumBank("Yapı Kredi Bankası")).toBe(true);
    expect(isOptimumBank("KOOPBANK")).toBe(true);
    expect(isOptimumBank("Türkiye İş Bankası")).toBe(false);
    expect(isOptimumBank("Cardplus Nova Bank")).toBe(false);
    expect(isOptimumBank(null)).toBe(false);
  });
  it("Optimum diğerlerinden fazlaysa ok", () => {
    const s = optimumShareOf([
      { bank_name: "Yapı Kredi", net_amount_try: "60000" },
      { bank_name: "Koopbank", net_amount_try: 5000 },
      { bank_name: "T. İş Bankası", net_amount_try: "40000" },
    ]);
    expect(s.status).toBe("ok");
    expect(s.optimum).toBe(65000);
    expect(s.other).toBe(40000);
    expect(Math.round(s.share * 100)).toBe(62);
    expect(s.banks[0]).toEqual({ name: "Yapı Kredi", total: 60000, optimum: true });
  });
  it("Optimum eşit ya da altındaysa low; fiş yoksa no_pos", () => {
    expect(optimumShareOf([{ bank_name: "Yapı Kredi", net_amount_try: 100 }, { bank_name: "İş Bankası", net_amount_try: 100 }]).status).toBe("low");
    expect(optimumShareOf([{ bank_name: "Yapı Kredi", net_amount_try: 10 }, { bank_name: "İş Bankası", net_amount_try: 90 }]).share).toBe(0.1);
    expect(optimumShareOf([]).status).toBe("no_pos");
    expect(optimumShareOf([{ bank_name: "Yapı Kredi", net_amount_try: 500 }]).status).toBe("ok");
  });
});
