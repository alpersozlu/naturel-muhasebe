import { describe, expect, it } from "vitest";
import { matchReceiptAmount, splitPaymentNote } from "@/lib/corporate-receipt-match";
import { corporateReceiptOcrSchema } from "@/server/services/ocr/schemas/corporate-receipt";

/** Mavi Mağusa 10.11.2026, fatura 9402000013251130 — Büşra Kaçmaz. */
const BUSRA = {
  payable_total: 9239.94,
  payments: [
    { label: "T.C. ZİRAAT BANKASI A.Ş. (TEK ÇEKİM)", amount: 799.94 },
    { label: "NAKİT", amount: 8440 },
  ],
};

describe("kurumsal / yönetim alışverişi — fiş tutarı eşleşmesi", () => {
  it("tutar Ödenecek Tutar'la aynıysa tam eşleşme (olağan durum)", () => {
    expect(matchReceiptAmount({ amount: 3919.96, payable_total: 3919.96, payments: [{ label: "NAKİT", amount: 3919.96 }] })).toEqual({ ok: true, kind: "full" });
    expect(matchReceiptAmount({ amount: 3920, payable_total: 3919.96, payments: [] }).ok).toBe(true);
    expect(matchReceiptAmount({ amount: 3919.96, payable_total: 3919.96, payments: null }).ok).toBe(true);
  });

  it("bölünmüş ödemede fişin NAKİT satırı kabul edilir (11.11.2026 vakası)", () => {
    const m = matchReceiptAmount({ amount: 8440, ...BUSRA });
    expect(m).toEqual({ ok: true, kind: "cash_part", cash: 8440, other: 799.94, other_labels: ["T.C. ZİRAAT BANKASI A.Ş. (TEK ÇEKİM)"] });
    if (m.ok && m.kind === "cash_part") {
      expect(splitPaymentNote(m, BUSRA.payable_total)).toBe(
        "Fiş toplamı 9.239,94 ₺; 799,94 ₺ kişinin kendi ödemesi (T.C. ZİRAAT BANKASI A.Ş. (TEK ÇEKİM)), gün sonuna satış olarak yansır."
      );
    }
  });

  it("bölünmüş ödemede fişin tamamı da girilebilir", () => {
    expect(matchReceiptAmount({ amount: 9239.94, ...BUSRA })).toEqual({ ok: true, kind: "full" });
  });

  it("kart satırının tutarı ya da başka bir tutar kabul edilmez; mesaj nakit tutarını söyler", () => {
    for (const amount of [799.94, 8000, 8441]) {
      const m = matchReceiptAmount({ amount, ...BUSRA });
      expect(m.ok).toBe(false);
      if (!m.ok) {
        expect(m.message).toContain("8.440,00 ₺ girin");
        expect(m.message).toContain("toplam 9.239,94 ₺");
      }
    }
  });

  it("satırlar fiş toplamını vermiyorsa (yanlış okuma) bölünmüş ödeme sayılmaz", () => {
    const m = matchReceiptAmount({ amount: 8440, payable_total: 9239.94, payments: [{ label: "NAKİT", amount: 8440 }, { label: "KART", amount: 79.94 }] });
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.message).toContain("uyuşmuyor");
  });

  it("tek satırlı fişte kısmi tutar kabul edilmez", () => {
    const m = matchReceiptAmount({ amount: 8440, payable_total: 9239.94, payments: [{ label: "NAKİT", amount: 9239.94 }] });
    expect(m.ok).toBe(false);
  });

  it("eski okumalarda payments alanı yoktur: boş liste sayılır", () => {
    const parsed = corporateReceiptOcrSchema.parse({
      is_receipt: true, rejection_reason: null, payable_total: 100, gross_total: null, discount_total: null,
      receipt_date: null, invoice_no: null, customer_name: null, store_line: null, payment_type: "NAKİT", currency: "TRY",
    });
    expect(parsed.payments).toEqual([]);
  });
});
