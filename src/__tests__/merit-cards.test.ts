import { describe, expect, it } from "vitest";
import { nameSimilarity, normalizeName, photoDateFromName } from "@/server/services/merit/cards";
import { extraRateOf, hotelOf, isExtraOk, meritRuleApplies, meritStatus, noteApproves } from "@/server/services/merit/check";
import { storeMatchStatus } from "@/server/services/merit/store-match";

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

describe("ek %10 ve yönetim notu", () => {
  it("dip iskonto ÷ (fiyat − satır iskontosu): Hatice Özer 30.09 = %10, Halyna Tanık 08.10 = %6,2", () => {
    expect(extraRateOf(7999.99 + 989.99, 800 + 99)).toBeCloseTo(0.1, 3);
    expect(isExtraOk(extraRateOf(7999.99 + 989.99, 800 + 99))).toBe(true);
    const halyna = extraRateOf(959.99 + 1499.99 + 1499.99, 59.63 + 93.17 + 93.17);
    expect(halyna).toBeCloseTo(0.0621, 3);
    expect(isExtraOk(halyna)).toBe(false);
    expect(extraRateOf(0, 0)).toBeNull();
    expect(isExtraOk(0.0987)).toBe(true); // Zekeriya 17.09 — blink dahil küsurat
  });
  it("yönetim notu: %10 + otel adı birlikte", () => {
    expect(noteApproves("%10 Merit")).toBe(true);
    expect(noteApproves("merıt %10")).toBe(true);
    expect(noteApproves("merit peronel")).toBe(false); // 10 yok
    expect(noteApproves("%10 arkadas indirimi")).toBe(false); // otel yok
    expect(noteApproves(null)).toBe(false);
  });
});

describe("mağaza tarafı doğrulama durumu", () => {
  const inv = (o: Partial<{ hotel: string | null; note_ok: boolean; extra_ok: boolean }>) => ({
    invoice_ref: "1-R-7-1", invoice_date: "2026-10-09", total: 100, mgmt_note: null, hotel: null, note_ok: false, extra_rate: 0.1, extra_ok: true, ...o,
  });
  it("okunamayan / fiş yok / not bekliyor / ek %10 tutmuyor / doğrulandı", () => {
    expect(storeMatchStatus([], false)).toBe("unreadable");
    expect(storeMatchStatus([], true)).toBe("not_found");
    expect(storeMatchStatus([inv({})], true)).toBe("note_pending");
    expect(storeMatchStatus([inv({ hotel: "Merit", note_ok: true, extra_ok: false })], true)).toBe("extra_mismatch");
    expect(storeMatchStatus([inv({ hotel: "Merit", note_ok: true, extra_ok: true })], true)).toBe("confirmed");
  });
});
