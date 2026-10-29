import { describe, expect, it } from "vitest";
import { isJacketCode, isOutletJacket } from "@/server/services/payroll/rules";

// Sahibi 29.10.2026: outlet ceketlere giysi primi yok. Örnekler Ekim 2026 Lefkoşa Nebim satırları.
describe("outlet ceket kuralı", () => {
  it("ürün kodunun 4. harfi G = ceket", () => {
    expect(isJacketCode("21WGD5921NC")).toBe(true);
    expect(isJacketCode("26WGE64451M")).toBe(true);
    expect(isJacketCode("25WAB123")).toBe(false);
    expect(isJacketCode(null)).toBe(false);
  });
  it("eski sezon + liste < 13.000 = outlet", () => {
    expect(isOutletJacket("21WGD5921NC", 8999.99)).toBe(true); // Rachel, raf 4.999,99
    expect(isOutletJacket("17WGE54421M", 7499.99)).toBe(true); // Brenda, raf 5.999,99
    expect(isOutletJacket("21WGD6421VE", 12599.99)).toBe(true); // Butler
    expect(isOutletJacket("20SGD5859U4", -24999.99)).toBe(false); // Kiara, iade satırı eksi liste
  });
  it("yeni sezon ya da pahalı liste = normal ceket", () => {
    expect(isOutletJacket("20SGD5859U4", 24999.99)).toBe(false);
    expect(isOutletJacket("24WGE1", 14299.99)).toBe(false);
    expect(isOutletJacket("26WGE64451M", 7499.99)).toBe(false);
    expect(isOutletJacket("21WAB1", 4999.99)).toBe(false); // ceket değil
  });
});
