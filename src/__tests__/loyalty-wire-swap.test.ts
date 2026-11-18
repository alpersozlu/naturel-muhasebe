import { describe, expect, it } from "vitest";
import { reconcileLoyaltyWireWithSap } from "@/server/services/ocr/extra-rows";

/**
 * Kartuş Puan ↔ Havale takası (17.11.2026 Mavi Güzelyurt): IT POS özetinde iki
 * komşu satırın tutarları yer değiştirmiş okundu; denklem sıradan bağımsız
 * olduğu için yine tuttu. SAP bayi raporu iki kalemi ayrı ve kuruşu kuruşuna
 * tutar — takas yalnız İKİ YÖNDE DE birebir eşleşirse yapılır.
 */
describe("Kartuş ↔ Havale takası (SAP hakem)", () => {
  it("17.11 Güzelyurt: yer değiştirmiş iki satır düzelir", () => {
    const r = reconcileLoyaltyWireWithSap({ loyalty: 1499.99, wire: 1140 }, { loyalty: 1140, wire: 1499.99 });
    expect(r).not.toBeNull();
    expect(r!.loyalty).toBe(1140);
    expect(r!.wire).toBe(1499.99);
  });

  it("zaten doğruysa dokunmaz", () => {
    expect(reconcileLoyaltyWireWithSap({ loyalty: 1140, wire: 1499.99 }, { loyalty: 1140, wire: 1499.99 })).toBeNull();
  });

  it("tek yönde eşleşme yetmez (rastlantı) — dokunmaz", () => {
    // özet kartuş = SAP havale ama özet havale ≠ SAP kartuş
    expect(reconcileLoyaltyWireWithSap({ loyalty: 1499.99, wire: 900 }, { loyalty: 1140, wire: 1499.99 })).toBeNull();
  });

  it("iki değer eşitse takas anlamsız — dokunmaz", () => {
    expect(reconcileLoyaltyWireWithSap({ loyalty: 500, wire: 500 }, { loyalty: 500, wire: 500 })).toBeNull();
  });

  it("havale satırı düşmüş, tutarı kartuşa yazılmış", () => {
    const r = reconcileLoyaltyWireWithSap({ loyalty: 1499.99, wire: null }, { loyalty: 0, wire: 1499.99 });
    expect(r).toEqual(expect.objectContaining({ loyalty: null, wire: 1499.99 }));
  });

  it("kuruş farkı varsa dokunmaz (yalnız birebir)", () => {
    expect(reconcileLoyaltyWireWithSap({ loyalty: 1499.99, wire: 1140 }, { loyalty: 1140.5, wire: 1499.99 })).toBeNull();
  });

  it("kümülatif gün: önceki özet + bugünkü SAP ile karşılaştırır", () => {
    // önceki gün kartuş 300 / havale 200; bugün SAP kartuş 840 / havale 1299,99
    // → kümülatif doğru: kartuş 1140, havale 1499,99; özet ters okunmuş
    const r = reconcileLoyaltyWireWithSap(
      { loyalty: 1499.99, wire: 1140 },
      { loyalty: 840, wire: 1299.99 },
      { loyalty: 300, wire: 200 }
    );
    expect(r).toEqual(expect.objectContaining({ loyalty: 1140, wire: 1499.99 }));
  });
});
