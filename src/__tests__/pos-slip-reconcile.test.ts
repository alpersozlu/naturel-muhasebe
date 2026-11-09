import { describe, expect, it } from "vitest";
import { reconcileSectionTotal } from "@/server/services/ocr/parsers/pos-slip";

type Sec = Parameters<typeof reconcileSectionTotal>[0];

/** Derimod Lefkoşa 03.11.2026 — Yapı Kredi TechPOS "SLİP BİLGİ": 8 satır, basılı Toplam 48.040. */
function techpos(): Sec {
  const tx = [1500, 2500, 12940, 5000, 3900, 10200, 10000, 21000]; // 8. satır 2.000 iken 21.000 okundu
  return {
    net_amount: 67040,
    sales_amount: 67040,
    sales_count: 8,
    breakdown: tx.map((a, i) => ({ label: `SATIŞ ${i + 1}`, count: 1, amount: a })),
    total_candidates: [48040],
    transaction_amounts: tx,
  };
}

describe("POS slip total reconciliation", () => {
  it("işlem listesinin kopyası olan kırılım ikinci kanıt sayılmaz; basılı toplam kazanır (03.11.2026 vakası)", () => {
    const sec = techpos();
    const note = reconcileSectionTotal(sec);
    expect(sec.net_amount).toBe(48040);
    expect(sec.sales_amount).toBe(48040);
    expect(note).toContain("basılı toplam esas alındı");
    expect(note).toContain("satır 8 21000 okundu");
    expect(note).toContain("2000 olmalı");
  });

  it("kırılım yokken yalnız işlem listesi basılı toplamı ezemez", () => {
    const sec: Sec = { ...techpos(), breakdown: [] };
    reconcileSectionTotal(sec);
    expect(sec.net_amount).toBe(48040);
  });

  it("basılı toplam yanlış okunduysa gerçek kırılım + işlem listesi (iki ayrı kaynak) hâlâ kazanır (31.08.2026 vakası)", () => {
    const sec: Sec = {
      net_amount: 91610,
      sales_amount: 91610,
      sales_count: 38,
      breakdown: [
        { label: "VISA", count: 1, amount: 6700 },
        { label: "MASTER", count: 19, amount: 38149 },
        { label: "TROY", count: 17, amount: 39081 },
        { label: "DEBIT", count: 1, amount: 7600 },
      ],
      total_candidates: [91530, 91610],
      transaction_amounts: [6700, 38149, 39081, 7600, 0].filter((x) => x > 0).concat([]),
    };
    // transaction list genuinely different from the breakdown: 38 lines in the real slip; here 5 lines summing to 91530
    sec.transaction_amounts = [20000, 20000, 20000, 20000, 11530];
    reconcileSectionTotal(sec);
    expect(sec.net_amount).toBe(91530);
  });

  it("net basılı toplamla zaten aynıysa dokunmaz", () => {
    const sec: Sec = { ...techpos(), net_amount: 48040, sales_amount: 48040 };
    expect(reconcileSectionTotal(sec)).toBeNull();
    expect(sec.net_amount).toBe(48040);
  });

  it("ortak terminalde 0 işlemli bölüm (yalnız basılı genel toplam, satır yok) değişmez", () => {
    const sec: Sec = { net_amount: 0, sales_amount: 0, sales_count: 0, breakdown: [], total_candidates: [27768], transaction_amounts: [] };
    expect(reconcileSectionTotal(sec)).toBeNull();
    expect(sec.net_amount).toBe(0);
  });

  it("basılı toplam ile adetli kırılım tek rakam farklıysa karar ikinci bakışa bırakılır", () => {
    const sec: Sec = {
      net_amount: 43169.72,
      sales_amount: 43169.72,
      sales_count: 14,
      breakdown: Array.from({ length: 14 }, (_, i) => ({ label: `SATIŞ`, count: 1, amount: i === 0 ? 43159.72 - 13 * 1000 : 1000 })),
      total_candidates: [43169.72],
      transaction_amounts: [],
    };
    expect(reconcileSectionTotal(sec)).toBe("__tie__");
  });
});
