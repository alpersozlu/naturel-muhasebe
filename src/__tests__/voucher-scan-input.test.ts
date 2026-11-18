import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cleanReceiptRef } from "@/server/services/gift-voucher/check";
import { parseVoucherBarcode } from "@/lib/gift-voucher-rules";

/**
 * Okutma kutusunda eski yazı kalınca barkod okuyucu yeni numarayı ARKAYA ekler
 * (18.11.2026 Mavi Mağusa: "940200001" + "9402000011781980" → gerçek fiş
 * "bulunamadı", "sahte" denildi). Son okutulan numara ayıklanır.
 */
describe("fiş numarası (Fatura No) temizliği", () => {
  it("18.11 Mağusa: kutudaki eski rakamların arkasına okutulan Fatura No ayıklanır", () => {
    expect(cleanReceiptRef("9402000019402000011781980")).toBe("9402000011781980");
  });
  it("aynı barkod iki kez okutulduysa tek numara kalır", () => {
    expect(cleanReceiptRef("94000000130711379400000013071137")).toBe("9400000013071137");
  });
  it("normal 16 hane olduğu gibi kalır; boşluklar silinir", () => {
    expect(cleanReceiptRef(" 9402 0000 1178 1980 ")).toBe("9402000011781980");
  });
  it("sonu Fatura No biçiminde değilse dokunulmaz (karar sistemde)", () => {
    expect(cleanReceiptRef("12345678901234567890")).toBe("12345678901234567890");
  });
});

describe("çek barkodu temizliği", () => {
  it("geçerli çek barkoduyla biten uzun girdi → son 13 hane", () => {
    const r = parseVoucherBarcode("2902900723650637");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.barcode).toBe("2900723650637");
  });
  it("tek ve doğru barkod aynen kabul edilir", () => {
    const r = parseVoucherBarcode("2900723650637");
    expect(r.ok).toBe(true);
  });
  it("son 13 hane geçerli değilse yine reddedilir", () => {
    expect(parseVoucherBarcode("29007236506371").ok).toBe(false);
  });
});
