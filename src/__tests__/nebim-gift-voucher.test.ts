import { describe, expect, it } from "vitest";
import { deriveNebimPayments } from "@/server/services/ocr/parsers/store-summary";

// Derimod Lefkoşa 13.10.2026 "Mağaza Hareket Özeti (Hediye Çekli)" — real figures.
const SALES = 82709.83;
const BALANCES = { opening: 22942612.78, closing: 22942612.78 + 12019.97 };
const TYPES = [
  "Nakit | ",
  "Kredi Kartı | ASBANK",
  "Kredi Kartı | KOOP BANK",
  "Kredi Kartı | T.IŞ BANKASI A.S.",
  "Kredi Çeki | ",
];
const TOTALS = [12019.97, 8249.99, 61929.91, 509.96, 0];
const EXPECTED = { cash_sales: 12019.97, credit_card_total: 70689.86, credit_voucher_total: 0 };

describe("deriveNebimPayments — Hediye Çeki bilgi satırı (Nebim YUKLE20)", () => {
  it("reads the report without a gift voucher row as before", () => {
    expect(deriveNebimPayments(TYPES, TOTALS, SALES, BALANCES)).toEqual(EXPECTED);
  });

  it("skips the information row printed under Kredi Çeki", () => {
    const types = [...TYPES, "Hediye Çeki | 1.750,00 TL (indirim olarak düşüldü)"];
    expect(deriveNebimPayments(types, [...TOTALS, 0], SALES, BALANCES)).toEqual(EXPECTED);
  });

  it("skips it when the model leaves the description out", () => {
    expect(deriveNebimPayments([...TYPES, "Hediye Çeki | "], [...TOTALS, 0], SALES, BALANCES)).toEqual(EXPECTED);
  });

  it("does not move money when the description's amount is read as the row total", () => {
    const types = [...TYPES, "Hediye Çeki | 1.750,00 TL (indirim olarak düşüldü)"];
    // Before the fix this row was a "card" (its description looks like a bank name) and the
    // sum missed the sales total by 1.750 → the paired lists were dropped.
    expect(deriveNebimPayments(types, [...TOTALS, 1750], SALES, BALANCES)).toEqual(EXPECTED);
  });

  it("still treats a named bank as a card and Kredi Çeki as a voucher", () => {
    const types = ["Nakit | ", "Kredi Kartı | KOOP BANK", "Kredi Çeki | ", "Hediye Çeki | 500,00 TL (indirim olarak düşüldü)"];
    const r = deriveNebimPayments(types, [1000, 2500, 499.99, 0], 3999.99);
    expect(r).toEqual({ cash_sales: 1000, credit_card_total: 2500, credit_voucher_total: 499.99 });
  });

  it("still rejects rows that do not add up", () => {
    const types = [...TYPES, "Hediye Çeki | "];
    expect(deriveNebimPayments(types, [12019.97, 8249.99, 60000, 509.96, 0, 0], SALES)).toBeNull();
  });
});
