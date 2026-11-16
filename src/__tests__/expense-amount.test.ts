import { describe, expect, it } from "vitest";
import { reconcileExpenseAmount } from "@/server/services/ocr/expense-amount";

describe("el yazısı fatura tutarı (sahibi, 16.11.2026 — 2.200 ₺ terzi faturası)", () => {
  it("üç yer de aynıysa tutar kesindir, el yazısı olsa bile", () => {
    const r = reconcileExpenseAmount({
      amount: 2200, amount_raw: "=2200=", line_total: 2200, subtotal: 2200, grand_total: 2200, amount_ambiguous: true,
    });
    expect(r).toEqual({ amount: 2200, source: "model", needs_review: false, note: null });
  });

  it("bir yer yanlış okunduysa ÇOĞUNLUK kazanır (7.200 ↔ 2.200 vakası)", () => {
    const r = reconcileExpenseAmount({
      amount: 7200, amount_raw: null, line_total: 2200, subtotal: 2200, grand_total: 7200,
    });
    expect(r.amount).toBe(2200);
    expect(r.source).toBe("majority");
    expect(r.note).toContain("Çoğunluk esas alındı");
  });

  it("yazıyla tutar varsa rakamı ezer", () => {
    const r = reconcileExpenseAmount({ amount: 7200, amount_in_words: "İki Bin İki Yüz TL", grand_total: 7200 });
    expect(r.amount).toBe(2200);
    expect(r.source).toBe("words");
  });

  it("yazı rakamı doğruluyorsa dokunmaz", () => {
    const r = reconcileExpenseAmount({ amount: 2200, amount_in_words: "İki Bin İki Yüz", grand_total: 2200 });
    expect(r).toMatchObject({ amount: 2200, source: "model", needs_review: false });
  });

  it("belgedeki toplam, modelin kendi okumasını ezer", () => {
    const r = reconcileExpenseAmount({ amount: 7200, grand_total: 2200 });
    expect(r.amount).toBe(2200);
    expect(r.source).toBe("majority");
    expect(r.note).toContain("genel toplam");
  });

  it("iki yer eşit şekilde çelişiyorsa (berabere) gözden geçirilsin", () => {
    const r = reconcileExpenseAmount({ amount: 7200, line_total: 2200, grand_total: 7200 });
    expect(r.amount).toBe(7200);
    expect(r.needs_review).toBe(true);
    expect(r.note).toContain("çelişiyor");
  });

  it("modelin amount'u oya katılmaz: iki yer 2.200 derse 7.200 kazanamaz", () => {
    const r = reconcileExpenseAmount({ amount: 7200, line_total: 2200, subtotal: 2200, grand_total: 7200 });
    expect(r.amount).toBe(2200);
    expect(r.source).toBe("majority");
  });

  it("tek okuma + model emin değilse gözden geçirilsin", () => {
    const r = reconcileExpenseAmount({ amount: 2200, amount_ambiguous: true });
    expect(r.needs_review).toBe(true);
    expect(r.note).toContain("tek yerde");
  });

  it("olağan basılı fatura: tek okuma, model emin → uyarı yok", () => {
    const r = reconcileExpenseAmount({ amount: 1899.97, amount_ambiguous: false });
    expect(r).toEqual({ amount: 1899.97, source: "model", needs_review: false, note: null });
  });
});
