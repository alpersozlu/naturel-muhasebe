import { describe, expect, it } from "vitest";
import { distinctDocumentNo, normalizeDocumentNo } from "@/server/services/ocr/process-upload";

describe("masraf mükerrer: basılı fatura numarası ayırt eder", () => {
  it("normalize", () => {
    expect(normalizeDocumentNo("No: 1419")).toBe("1419");
    expect(normalizeDocumentNo("A-001419")).toBe("A001419"); // harf sonrası sıfırlar korunur, iki okumada aynı normalize
    expect(normalizeDocumentNo(" 1418 ")).toBe("1418");
    expect(normalizeDocumentNo("?")).toBeNull();
    expect(normalizeDocumentNo(null)).toBeNull();
  });
  it("Erdal Fındık 16.10: 1418 ↔ 1419 ayrı belge; aynı numara ya da eksik numara → ayırt edemez", () => {
    expect(distinctDocumentNo("1418", "1419")).toBe(true);
    expect(distinctDocumentNo("No:1419", "1419")).toBe(false);
    expect(distinctDocumentNo("1419", null)).toBe(false);
    expect(distinctDocumentNo(null, null)).toBe(false);
  });
});
