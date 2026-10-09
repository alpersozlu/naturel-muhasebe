import { describe, expect, it } from "vitest";
import { nameSimilarity, normalizeName, photoDateFromName } from "@/server/services/merit/cards";
import { hotelOf, meritRuleApplies, meritStatus } from "@/server/services/merit/check";

describe("Merit kartı — ad eşleştirme", () => {
  it("normalize: Türkçe harf, boşluk, büyük/küçük", () => {
    expect(normalizeName(" Alİna  Nanaeva ")).toBe("ALINA NANAEVA");
    expect(normalizeName("KEMAL TEKELİOĞLU")).toBe("KEMAL TEKELIOGLU");
    expect(normalizeName("Gökhan Qubat")).toBe("GOKHAN QUBAT");
  });
  it("aynı kişi: tam eşleşme, bitişik yazım, ad/soyad sırası", () => {
    expect(nameSimilarity("MUSTAFA TOSUN", "MUSTAFA TOSUN")).toBe(1);
    expect(nameSimilarity("KEMALTEKELIOĞLU", "KEMAL TEKELİOĞLU")).toBeGreaterThanOrEqual(0.8); // fişte bitişik yazılmış
    expect(nameSimilarity("BERKTUN MEHMET", "MEHMET BERKTUN")).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("HATİCE ÖZER", "Hatice Özer")).toBe(1);
  });
  it("OCR tek harf hatası: KÖRÜKÇÜ ↔ KÖRÜKCİ yine aynı kişi; Ahmed Kurabnoplu ↔ Kurbanov yalnız öneri", () => {
    expect(nameSimilarity("BARIŞ KÖRÜKÇÜ", "BARIŞ KÖRÜKCİ")).toBeGreaterThanOrEqual(0.8);
    const s = nameSimilarity("AHMED KURABNOPLU", "AHMED KURBANOV");
    expect(s).toBeGreaterThanOrEqual(0.4);
    expect(s).toBeLessThan(0.8);
  });
  it("farklı kişi düşük kalır", () => {
    expect(nameSimilarity("HALYNA TANIK", "ALİNA NANAEVA")).toBeLessThan(0.4);
    expect(nameSimilarity("MUSTAFA TOSUN", "MUSTAFA ÖZER")).toBeLessThan(0.8);
    expect(nameSimilarity("", "X Y")).toBe(0);
  });
  it("dosya adından çekim tarihi", () => {
    expect(photoDateFromName("IMG_20260909_192414.jpg")).toBe("2026-09-09");
    expect(photoDateFromName("ALİNA NANAEVA.jpg")).toBeNull();
    expect(photoDateFromName("IMG_20261399_1.jpg")).toBeNull();
  });
});

describe("Merit %10 — kart zorunluluğu ve durum", () => {
  it("Girne baştan beri, Lefkoşa 08.10.2026'dan itibaren, Mağusa programda değil", () => {
    expect(meritRuleApplies("S03", "2026-03-01")).toBe(true);
    expect(meritRuleApplies("S01", "2026-10-07")).toBe(false);
    expect(meritRuleApplies("S01", "2026-10-08")).toBe(true);
    expect(meritRuleApplies("S02", "2026-10-08")).toBe(false);
    expect(meritRuleApplies(null, "2026-10-08")).toBe(false);
  });
  it("elle karar otomatik eşleşmeyi ezer; kart yoksa ve zorunluysa 'missing'", () => {
    expect(meritStatus({ decision: "card", autoScore: 0, required: true })).toBe("ok_card");
    expect(meritStatus({ decision: "no_card_ok", autoScore: 0, required: true })).toBe("ok_no_card");
    expect(meritStatus({ decision: "rejected", autoScore: 1, required: true })).toBe("rejected");
    expect(meritStatus({ decision: null, autoScore: 0.9, required: true })).toBe("ok_card");
    expect(meritStatus({ decision: null, autoScore: 0.5, required: true })).toBe("missing");
    expect(meritStatus({ decision: null, autoScore: 0.5, required: false })).toBe("not_required");
  });
});

describe("anlaşmalı kurum tanıma (yönetim notu)", () => {
  it("Merit tüm yazımlarıyla", () => {
    for (const n of ["%10 Merit", "MERİT PERSONELİ", "merıt %10", "mrt", "merit royal personeli 2214"]) expect(hotelOf(n)).toBe("Merit");
  });
  it("diğer kurumlar ve ilgisiz notlar", () => {
    expect(hotelOf("CRATOS PERSONEL")).toBe("Cratos");
    expect(hotelOf("lORDS %10")).toBe("Lord's Palace");
    expect(hotelOf("Tip-is yetkilisi %10 indirim")).toBe("Tip-İş");
    expect(hotelOf("tıp ıs")).toBe("Tip-İş");
    expect(hotelOf("500 TL HEDİYE ÇEKİ")).toBeNull();
    expect(hotelOf("personel indirimi")).toBeNull();
  });
});
