import { describe, expect, it } from "vitest";
import { nameSimilarity, normalizeName, photoDateFromName } from "@/server/services/merit/cards";
import { extraCheck, extraRateOf, hotelOf, isExtraOk, isMeritCampaign, meritRuleApplies, meritStatus, noteApproves } from "@/server/services/merit/check";
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
    expect(photoDateFromName("WhatsApp Image 2026-10-11 at 17.06.48.jpeg")).toBe("2026-10-11");
    expect(photoDateFromName("kart 11.10.2026.jpg")).toBe("2026-10-11");
    expect(photoDateFromName("IMG_20261399_1.jpg")).toBeNull();
  });
});

describe("Merit %10 — kart zorunluluğu ve durum", () => {
  it("Girne baştan beri, Lefkoşa 08.10.2026'dan, Mağusa 21.11.2026'dan (Nebim Merit kampanyası)", () => {
    expect(meritRuleApplies("S03", "2026-03-01")).toBe(true);
    expect(meritRuleApplies("S01", "2026-10-07")).toBe(false);
    expect(meritRuleApplies("S01", "2026-10-08")).toBe(true);
    expect(meritRuleApplies("S02", "2026-10-08")).toBe(false);
    expect(meritRuleApplies("S02", "2026-11-20")).toBe(false);
    expect(meritRuleApplies("S02", "2026-11-21")).toBe(true);
    expect(meritRuleApplies(null, "2026-10-08")).toBe(false);
  });
  it("elle karar otomatik eşleşmeyi ezer; kart yoksa ve zorunluysa 'missing'", () => {
    expect(meritStatus({ decision: "card", autoScore: 0, required: true })).toBe("ok_card");
    expect(meritStatus({ decision: "no_card_ok", autoScore: 0, required: true })).toBe("ok_no_card");
    expect(meritStatus({ decision: "rejected", autoScore: 1, required: true })).toBe("rejected");
    expect(meritStatus({ decision: null, autoScore: 0.9, required: true })).toBe("ok_card");
    expect(meritStatus({ decision: null, autoScore: 0.5, required: true })).toBe("missing");
    expect(meritStatus({ decision: null, autoScore: 0.5, required: false })).toBe("not_required");
    // personel listesi (20.10.2026): listede ad tutuyorsa kart aranmaz
    expect(meritStatus({ decision: null, autoScore: 0.5, required: true, listScore: 0.85 })).toBe("ok_list");
    expect(meritStatus({ decision: null, autoScore: 0.9, required: true, listScore: 0.85 })).toBe("ok_card");
    expect(meritStatus({ decision: "rejected", autoScore: 0, required: true, listScore: 1 })).toBe("rejected");
  });
});

describe("anlaşmalı kurum tanıma (yönetim notu)", () => {
  it("Merit tüm yazımlarıyla", () => {
    for (const n of ["%10 Merit", "MERİT PERSONELİ", "merıt %10", "mrt", "merit royal personeli 2214"]) expect(hotelOf(n)).toBe("Merit");
  });
  it("diğer kurumlar ve ilgisiz notlar", () => {
    expect(hotelOf("CRATOS PERSONEL")).toBe("Cratos");
    expect(hotelOf("CRATTOS %10 INDIRIM")).toBe("Cratos");
    expect(hotelOf("Les %10 indirim")).toBe("Les Ambassadeurs");
    expect(hotelOf("les ambassadeurs personeli")).toBe("Les Ambassadeurs");
    expect(hotelOf("lords palance")).toBe("Lord's Palace");
    expect(hotelOf("outlet 3lü 3900")).toBeNull();
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
  it("yönetim notu: otel adı yeter (sahibi 19.10.2026: 'merit yazması yeter')", () => {
    expect(noteApproves("%10 Merit")).toBe(true);
    expect(noteApproves("merıt %10")).toBe(true);
    expect(noteApproves("merit peronel")).toBe(true);
    expect(noteApproves("mrt")).toBe(true);
    expect(noteApproves("%10 arkadas indirimi")).toBe(false); // otel yok
    expect(noteApproves(null)).toBe(false);
  });
});

describe("mağaza tarafı doğrulama durumu", () => {
  const inv = (o: Partial<{ hotel: string | null; note_ok: boolean; extra_ok: boolean }>) => ({
    invoice_ref: "1-R-7-1", invoice_date: "2026-10-09", total: 100, mgmt_note: null, hotel: null, note_ok: false, extra_rate: 0.1, extra_ok: true, via_campaign: false, double_discount: false, manual: false, ...o,
  });
  it("yönetici elle bağladıysa her şeyin önünde 'approved' (kart okunamasa bile)", () => {
    expect(storeMatchStatus([{ ...inv({}), manual: true }], false)).toBe("approved");
    expect(storeMatchStatus([{ ...inv({ hotel: "Merit", note_ok: true, extra_ok: false }), manual: true }], true)).toBe("approved");
  });
  it("okunamayan / fiş yok / not bekliyor / ek %10 tutmuyor / doğrulandı", () => {
    expect(storeMatchStatus([], false)).toBe("unreadable");
    expect(storeMatchStatus([], true)).toBe("not_found");
    expect(storeMatchStatus([inv({})], true)).toBe("note_pending");
    expect(storeMatchStatus([inv({ hotel: "Merit", note_ok: true, extra_ok: false })], true)).toBe("extra_mismatch");
    expect(storeMatchStatus([inv({ hotel: "Merit", note_ok: true, extra_ok: true })], true)).toBe("confirmed");
  });
});

describe("Nebim MERİT KAMPANYASI (kasada MERİT %10 çeki + sicil, 20.11.2026)", () => {
  it("kampanya adını tanır — Nebim'in yazdığı büyük noktalı İ dahil; başka kampanya değil", () => {
    expect(isMeritCampaign("MERİT KAMPANYASI")).toBe(true);
    expect(isMeritCampaign("İndirim Kampanyası | MERİT KAMPANYASI")).toBe(true);
    expect(isMeritCampaign("BIRLESIK 20/50 KAMPANYA | Merit Kampanyası")).toBe(true);
    expect(isMeritCampaign("İndirim Kampanyası")).toBe(false);
    expect(isMeritCampaign("DERIMOD HEDIYE CEKI KULLANIMI")).toBe(false);
    expect(isMeritCampaign(null)).toBe(false);
    expect(hotelOf("İndirim Kampanyası | MERİT KAMPANYASI")).toBe("Merit");
  });
  it("kampanyalı fişte ek %10 Nebim'in hesabı; elle dip iskonto da varsa ÇİFT indirim", () => {
    // Lefkoşa T1: çanta 5.939,99 − kampanyalar (IND 1.190 + Merit 475) → satır iskontosu 1.665; dip yok
    expect(extraCheck(true, 5939.99 - 1665 + 1999.99, 0)).toEqual({ extra_rate: null, extra_ok: true, double_discount: false });
    // kampanya + elle %10 dip iskonto → çift
    const d = extraCheck(true, 6274.98, 627.5);
    expect(d.double_discount).toBe(true);
    expect(d.extra_ok).toBe(false);
    // elle Merit eskisi gibi: dip ÷ kampanya sonrası tutar
    expect(extraCheck(false, 7999.99, 800)).toEqual({ extra_rate: 0.1, extra_ok: true, double_discount: false });
    expect(extraCheck(false, 3959.97, 245.97).extra_ok).toBe(false);
  });
  it("mağaza kutusu: kampanyalı fiş kart yüklenince doğrudan 'Doğrulandı'; çift indirim 'Ek %10 tutmuyor'", () => {
    const base = { invoice_ref: "1-R-7-2", invoice_date: "2026-11-21", total: 6274.98, mgmt_note: null, hotel: "Merit", manual: false };
    expect(storeMatchStatus([{ ...base, note_ok: true, extra_rate: null, extra_ok: true, via_campaign: true, double_discount: false }], true)).toBe("confirmed");
    expect(storeMatchStatus([{ ...base, note_ok: true, extra_rate: 0.1, extra_ok: false, via_campaign: true, double_discount: true }], true)).toBe("extra_mismatch");
  });
});
