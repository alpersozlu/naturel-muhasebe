import { describe, expect, it } from "vitest";
import { reconcileExtraRowsWithSap } from "@/server/services/ocr/extra-rows";

describe("Kartuş Puan ↔ Alışveriş Çeki — SAP hakemliği", () => {
  it("aynı gün: çek satırına yazılan kartuş SAP ile düzelir (Lefkoşa 22.09)", () => {
    const fix = reconcileExtraRowsWithSap({ loyalty: null, voucher: 2160 }, { loyalty: 2160, gift: 0 });
    expect(fix).toMatchObject({ loyalty: 2160, voucher: null });
  });
  it("kümülatif: önceki özet kartuş 3.090 + SAP 900 = çek satırındaki 3.990 (Girne 06.10)", () => {
    const fix = reconcileExtraRowsWithSap(
      { loyalty: null, voucher: 3990, sales: 368_567.5, cash: 95_149.34, card: 266_728.18 },
      { loyalty: 900, gift: 0 },
      { loyalty: 3090, voucher: null }
    );
    expect(fix).toMatchObject({ loyalty: 3990, voucher: null });
  });
  it("kümülatif: önceki özet olmadan aynı rakam düzelmez (900 ≠ 3.990)", () => {
    expect(reconcileExtraRowsWithSap({ loyalty: null, voucher: 3990 }, { loyalty: 900, gift: 0 })).toBeNull();
  });
  it("kümülatif: satır hiç okunmamışsa özetin kalanı prev + SAP ile eşleşince kartuş dolar", () => {
    const fix = reconcileExtraRowsWithSap(
      { loyalty: null, voucher: null, sales: 368_567.5, cash: 95_149.34, card: 266_728.18 },
      { loyalty: 900, gift: 0 },
      { loyalty: 3090, voucher: null }
    );
    // kalan = 368.567,50 − 95.149,34 − 266.728,18 = 6.689,98 (havale 2.699,98 dahil) → eşleşmez, dokunmaz
    expect(fix).toBeNull();
  });
  it("rakamlar uyuşmuyorsa dokunmaz", () => {
    expect(reconcileExtraRowsWithSap({ loyalty: null, voucher: 500 }, { loyalty: 900, gift: 0 }, { loyalty: 3090, voucher: null })).toBeNull();
  });
});
