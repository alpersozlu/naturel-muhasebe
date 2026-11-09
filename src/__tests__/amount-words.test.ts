import { describe, expect, it } from "vitest";
import { parsePrintedAmount, parseTurkishAmountWords, reconcileReceiptAmount } from "@/server/services/ocr/amount-words";

describe("parseTurkishAmountWords", () => {
  it("Halkbank satırı: UÇBİNYÜZ %00 → 3100", () => {
    expect(parseTurkishAmountWords("Y/(TL) UÇBİNYÜZ %00")).toBe(3100);
    expect(parseTurkishAmountWords("ÜÇBİNYÜZ %00")).toBe(3100);
  });
  it("bileşik sayılar", () => {
    expect(parseTurkishAmountWords("ONBEŞBİNALTIYÜZELLİ %50")).toBe(15650.5);
    expect(parseTurkishAmountWords("BİRMİLYONİKİYÜZBİN")).toBe(1200000);
    expect(parseTurkishAmountWords("YÜZBİN")).toBe(100000);
    expect(parseTurkishAmountWords("BİNYÜZ")).toBe(1100);
    expect(parseTurkishAmountWords("ALTMIŞBEŞBİN")).toBe(65000);
    expect(parseTurkishAmountWords("ALTIYÜZ")).toBe(600);
    expect(parseTurkishAmountWords("YETMİŞYEDİ")).toBe(77);
    expect(parseTurkishAmountWords("iki yüz kırk üç bin beş yüz TL 25 kuruş")).toBe(243500.25);
  });
  it("çözülemeyen metin null", () => {
    expect(parseTurkishAmountWords("GİDEN FAST")).toBeNull();
    expect(parseTurkishAmountWords("")).toBeNull();
    expect(parseTurkishAmountWords(null)).toBeNull();
  });
});

describe("parsePrintedAmount", () => {
  it("Amerikan ve Türk biçimleri", () => {
    expect(parsePrintedAmount("3,100.00")).toBe(3100);
    expect(parsePrintedAmount("3.100,00")).toBe(3100);
    expect(parsePrintedAmount("1,234,567.89")).toBe(1234567.89);
    expect(parsePrintedAmount("1.234.567,89")).toBe(1234567.89);
    expect(parsePrintedAmount("250,50 TL")).toBe(250.5);
    expect(parsePrintedAmount("250.50")).toBe(250.5);
    expect(parsePrintedAmount("3100")).toBe(3100);
    expect(parsePrintedAmount("abc")).toBeNull();
  });
});

describe("reconcileReceiptAmount", () => {
  it("yazıyla tutar rakamı düzeltir (02.10.2026 olayı)", () => {
    const r = reconcileReceiptAmount({ amount: 3168.68, amount_raw: "3,168.68", amount_in_words: "UÇBİNYÜZ %00" });
    expect(r.amount).toBe(3100);
    expect(r.source).toBe("words");
  });
  it("yazı yoksa basılı metin biçim hatasını düzeltir", () => {
    const r = reconcileReceiptAmount({ amount: 3.1, amount_raw: "3,100.00", amount_in_words: null });
    expect(r.amount).toBe(3100);
    expect(r.source).toBe("raw");
  });
  it("uyumluysa model değeri kalır", () => {
    const r = reconcileReceiptAmount({ amount: 3100, amount_raw: "3,100.00", amount_in_words: "ÜÇBİNYÜZ %00" });
    expect(r.amount).toBe(3100);
    expect(r.source).toBe("model");
  });
});

describe("reconcileReceiptAmount — ücretli dekont (TEB 07.11.2026)", () => {
  const teb = { amount_raw: "13.047,00", fee_amounts: [15.96, 0.48], total_debited: 13863.44, total_debited_raw: "13.863,44" };
  it("rakam 13.047 okundu, yazı bozuk: hesaptan toplam − ücretler = 13.847 kazanır", () => {
    const r = reconcileReceiptAmount({ amount: 13047, amount_in_words: "Yalnız onüçbinelliyzaltmışüçTLkırkdörtkr", ...teb });
    expect(r.amount).toBe(13847);
    expect(r.source).toBe("total");
  });
  it("yazı toplamı doğru çözülürse yine transfer = toplam − ücretler", () => {
    const r = reconcileReceiptAmount({ amount: 13047, amount_in_words: "Yalnız onüçbinsekizyüzaltmışüçTLkırkdörtKr", ...teb });
    expect(r.amount).toBe(13847);
  });
  it("rakam denklemi tutuyorsa dokunmaz; yazı toplamı diye rakamı değiştirmez", () => {
    const r = reconcileReceiptAmount({ amount: 13847, amount_in_words: "Yalnız onüçbinsekizyüzaltmışüçTLkırkdörtKr", ...teb });
    expect(r.amount).toBe(13847);
    expect(r.source).toBe("model");
  });
  it("rakam çok farklı ve yazı yoksa rakam kalır, uyarı notu düşer", () => {
    const r = reconcileReceiptAmount({ amount: 9000, amount_in_words: null, ...teb });
    expect(r.amount).toBe(9000);
    expect(r.note).toContain("UYARI");
  });
  it("ücret yoksa eski davranış: yazı kazanır", () => {
    expect(reconcileReceiptAmount({ amount: 3168.68, amount_raw: "3,100.00", amount_in_words: "Y/(TL) UÇBİNYÜZ %00" }).amount).toBe(3100);
  });
});
