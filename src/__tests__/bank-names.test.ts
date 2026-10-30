import { describe, expect, it } from "vitest";
import { canonicalBankName, cardplusVia } from "@/lib/bank-names";

// Sahibi 30.10.2026: Gelir Analizi'nde üç ayrı CardPlus satırı vardı — tek satır olmalı.
describe("banka adları", () => {
  it("CardPlus yazılışları tek satır", () => {
    for (const raw of ["CardPlus", "Cardplus", "CARDPLUS", "Card Plus", "CardPlus / Nova Bank", "Cardplus Nova Bank", "CardPlus / Albank"]) {
      expect(canonicalBankName(raw)).toBe("CardPlus");
    }
  });
  it("CardPlus'ın geçtiği banka ayrıca okunur", () => {
    expect(cardplusVia("CardPlus / Nova Bank")).toBe("Nova Bank");
    expect(cardplusVia("Cardplus Nova Bank")).toBe("Nova Bank");
    expect(cardplusVia("CardPlus / Albank")).toBe("Albank");
    expect(cardplusVia("CardPlus")).toBeNull();
    expect(cardplusVia("Nova Bank")).toBeNull();
  });
  it("diğer bankalar eskisi gibi", () => {
    expect(canonicalBankName("T. İş Bankası A.Ş.")).toBe("İş Bankası");
    expect(canonicalBankName("Yapı ve Kredi Bankası")).toBe("Yapı Kredi");
    expect(canonicalBankName("ALBANK")).toBe("Albank");
    expect(canonicalBankName("ZIRAAT BANKASI")).toBe("Ziraat Bankası");
    expect(canonicalBankName("YAPI KREDI")).toBe("Yapı Kredi");
    expect(canonicalBankName("TÜRKIYE İŞ BANKASI")).toBe("İş Bankası");
    expect(canonicalBankName("Nova Bank")).toBe("Nova Bank");
    expect(canonicalBankName(null)).toBe("Bilinmeyen");
  });
});
