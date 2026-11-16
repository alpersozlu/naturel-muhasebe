import { describe, expect, it } from "vitest";
import {
  checkVoucher,
  entitlementFor,
  splitIntoDenominations,
  tierLabel,
  tierFor,
  voucherDeadline,
} from "@/lib/gift-voucher-rules";

describe("hediye çeki kademeleri (sahibi tablosu, 16.11.2026)", () => {
  it("tablodaki her aralık", () => {
    expect(entitlementFor(5000)).toBe(500);
    expect(entitlementFor(6999.99)).toBe(500);
    expect(entitlementFor(7000)).toBe(750);
    expect(entitlementFor(8099.94)).toBe(750); // gönderilen gerçek fiş
    expect(entitlementFor(9000)).toBe(1000);
    expect(entitlementFor(13999.99)).toBe(1000);
    expect(entitlementFor(14000)).toBe(1500);
    expect(entitlementFor(17000)).toBe(1750);
    expect(entitlementFor(20000)).toBe(2000);
    expect(entitlementFor(125000)).toBe(2000);
  });
  it("5.000 altı çek hak etmez", () => {
    for (const a of [0, 1, 4999.99]) expect(entitlementFor(a)).toBe(0);
  });
  it("sınır ÜST kademeye sayılır", () => {
    expect(tierLabel(tierFor(7000)!)).toBe("7.000 – 9.000 ₺");
    expect(tierLabel(tierFor(6999.99)!)).toBe("5.000 – 7.000 ₺");
    expect(tierLabel(tierFor(20000)!)).toBe("20.000 ₺ ve üzeri");
  });
  it("1.500 ve üstü basılı küpürlere bölünür (500/750/1000)", () => {
    expect(splitIntoDenominations(500)).toEqual({ parts: [500], rest: 0 });
    expect(splitIntoDenominations(1500)).toEqual({ parts: [1000, 500], rest: 0 });
    expect(splitIntoDenominations(1750)).toEqual({ parts: [1000, 750], rest: 0 });
    expect(splitIntoDenominations(2000)).toEqual({ parts: [1000, 1000], rest: 0 });
  });
  it("son kullanma: fiş tarihi + 1 ay, ay sonu taşması kırpılır", () => {
    expect(voucherDeadline("2026-11-06")).toBe("2026-12-06");
    expect(voucherDeadline("2026-12-15")).toBe("2027-01-15");
    expect(voucherDeadline("2026-07-31")).toBe("2026-08-31");
  });
  it("27.07.2026 ÖNCESİ alışverişin çeki SÜRESİZ (sahibi: o müşterilere tarih verilmedi)", () => {
    expect(voucherDeadline("2026-07-26")).toBeNull();
    expect(voucherDeadline("2026-01-31")).toBeNull();
    expect(voucherDeadline("2026-07-27")).toBe("2026-08-27"); // kuralın başladığı gün dahil
  });
});

describe("çek denetimi", () => {
  const base = {
    receipt_amount: 8099.94,
    receipt_date: "2026-11-06",
    other_vouchers_total: 0,
    voucher_amount: 750,
    used_date: "2026-11-16",
    source_loaded: true,
  };
  it("doğru çek, süresi içinde → uygun", () => {
    const r = checkVoucher(base);
    expect(r.status).toBe("ok");
    expect(r.reasons).toEqual([]);
    expect(r.entitlement).toBe(750);
    expect(r.deadline).toBe("2026-12-06");
  });
  it("fazla küpür → uygunsuz, sebebi yazar", () => {
    const r = checkVoucher({ ...base, voucher_amount: 1000 });
    expect(r.status).toBe("fail");
    expect(r.reasons[0]).toContain("hak edişi 750,00 ₺");
  });
  it("aynı fişe ikinci çek: toplam hak edişi aşarsa yakalanır", () => {
    expect(checkVoucher({ ...base, other_vouchers_total: 750 }).status).toBe("fail");
    // 20.000 ₺ fiş → 2.000 hak ediş: 1.000 + 1.000 geçerli
    const iki = checkVoucher({ ...base, receipt_amount: 21000, voucher_amount: 1000, other_vouchers_total: 1000 });
    expect(iki.status).toBe("ok");
  });
  it("1 ay geçmişse yakalanır", () => {
    const r = checkVoucher({ ...base, used_date: "2026-12-07" });
    expect(r.status).toBe("fail");
    expect(r.reasons[0]).toContain("son gün 06.12.2026");
  });
  it("fişten önce kullanılmış çek yakalanır", () => {
    expect(checkVoucher({ ...base, used_date: "2026-11-05" }).status).toBe("fail");
  });
  it("5.000 altı fişe çek verilmiş → yakalanır", () => {
    const r = checkVoucher({ ...base, receipt_amount: 4800 });
    expect(r.status).toBe("fail");
    expect(r.reasons[0]).toContain("5.000 ₺ altı");
  });
  it("eski çek (27.07 öncesi) aylar sonra kullanılsa da uygun", () => {
    const r = checkVoucher({ ...base, receipt_amount: 8099.94, receipt_date: "2026-05-10", used_date: "2026-11-16" });
    expect(r.status).toBe("ok");
    expect(r.unlimited).toBe(true);
    expect(r.deadline).toBeNull();
  });
  it("27.07 sonrası aynı gecikme uygunsuz", () => {
    const r = checkVoucher({ ...base, receipt_date: "2026-08-10", used_date: "2026-11-16" });
    expect(r.status).toBe("fail");
    expect(r.unlimited).toBe(false);
  });
  it("iade fişi işaretlenir", () => {
    expect(checkVoucher({ ...base, receipt_refund: true }).reasons[0]).toContain("iade");
  });
  it("Mavi dosyası gelmediyse BEKLİYOR (hata değil)", () => {
    const r = checkVoucher({ ...base, receipt_amount: null, receipt_date: null, source_loaded: false });
    expect(r.status).toBe("pending");
    expect(r.reasons[0]).toContain("henüz yüklenmedi");
  });
  it("dosya geldi ama fiş yoksa SAHTE/yanlış numara", () => {
    const r = checkVoucher({ ...base, receipt_amount: null, receipt_date: null, source_loaded: true });
    expect(r.status).toBe("fail");
    expect(r.reasons[0]).toContain("Mavi kayıtlarında yok");
  });
});

describe("çek barkodu (EAN-13: 290 + küpür + sıra)", () => {
  it("küpürü barkoddan okur", async () => {
    const { parseVoucherBarcode } = await import("@/lib/gift-voucher-rules");
    const r = parseVoucherBarcode("2900500000013");
    expect(r).toEqual({ ok: true, barcode: "2900500000013", amount: 500, sequence: "0000001" });
    expect(parseVoucherBarcode("2900500099918")).toMatchObject({ ok: true, amount: 500 });
  });
  it("boşluk ve çizgi temizlenir", async () => {
    const { parseVoucherBarcode } = await import("@/lib/gift-voucher-rules");
    expect(parseVoucherBarcode(" 2900 5000 00013 ")).toMatchObject({ ok: true, amount: 500 });
  });
  it("yanlış barkodu reddeder ve sebebini söyler", async () => {
    const { parseVoucherBarcode } = await import("@/lib/gift-voucher-rules");
    expect(parseVoucherBarcode("1234567890123")).toMatchObject({ ok: false, reason: expect.stringContaining("290") });
    expect(parseVoucherBarcode("290050000001")).toMatchObject({ ok: false, reason: expect.stringContaining("13 haneli") });
    expect(parseVoucherBarcode("2900500000014")).toMatchObject({ ok: false, reason: expect.stringContaining("kontrol hanesi") });
    // 9400000013071137 = Mavi fişi; çek sanılmamalı
    expect(parseVoucherBarcode("9400000013071137").ok).toBe(false);
  });
  it("EAN kontrol hanesi", async () => {
    const { isValidEan13 } = await import("@/lib/gift-voucher-rules");
    expect(isValidEan13("2900500000013")).toBe(true);
    expect(isValidEan13("2900500000012")).toBe(false);
  });
});
