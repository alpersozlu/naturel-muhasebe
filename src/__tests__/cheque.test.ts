import { describe, expect, it } from "vitest";
import { chequeOcrSchema } from "@/server/services/ocr/schemas/cheque";
import { reconcileReceiptAmount } from "@/server/services/ocr/amount-words";

/** Near East Bank Güzelyurt, 14.11.2026, Naturel Ticaret'e 2.000 ₺ (ilk vaka). */
const KANER = {
  is_cheque: true,
  rejection_reason: null,
  bank_name: "Near East Bank",
  branch: "Güzelyurt Şb.",
  cheque_no: "8539837",
  payee_name: "Naturel Ticaret",
  drawer_name: "KANER SARUHAN",
  amount: 2000,
  amount_raw: "TL-2000 TL",
  amount_in_words: "İki Bin TL",
  cheque_date: "2026-11-14",
  currency: "TRY" as const,
};

describe("banka çeki okuması", () => {
  it("çekin alanları okunur; isteğe bağlı alanlar yoksa null", () => {
    const p = chequeOcrSchema.parse(KANER);
    expect(p.amount).toBe(2000);
    expect(p.payee_name).toBe("Naturel Ticaret");
    const az = chequeOcrSchema.parse({ is_cheque: true, rejection_reason: null, bank_name: "X Bank", amount: 500 });
    expect(az.cheque_no).toBeNull();
    expect(az.cheque_date).toBeNull();
    expect(az.currency).toBe("TRY");
  });

  it("rakam ile yazıyla tutar tutuyorsa rakam kalır", () => {
    const r = reconcileReceiptAmount({ amount: KANER.amount, amount_raw: KANER.amount_raw, amount_in_words: KANER.amount_in_words });
    expect(r.amount).toBe(2000);
    expect(r.note).toBeNull();
  });

  it("rakam yanlış okunduysa YAZIYLA tutar kazanır (2.000 ↔ 20.000)", () => {
    const r = reconcileReceiptAmount({ amount: 20000, amount_raw: "TL-2000 TL", amount_in_words: "İki Bin TL" });
    expect(r.amount).toBe(2000);
    expect(r.source).toBe("words");
  });

  it("yazı okunamadıysa kutudaki basılı tutar rakamı düzeltir", () => {
    const r = reconcileReceiptAmount({ amount: 2, amount_raw: "2.000,00", amount_in_words: null });
    expect(r.amount).toBe(2000);
  });

  it("çek değilse ret sebebi taşınır", () => {
    const p = chequeOcrSchema.parse({ is_cheque: false, rejection_reason: "Bu bir POS slibi", bank_name: null, amount: null });
    expect(p.is_cheque).toBe(false);
    expect(p.rejection_reason).toContain("POS");
  });
});
