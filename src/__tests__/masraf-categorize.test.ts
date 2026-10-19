import { describe, expect, it } from "vitest";
import { categorizeExpense, categorizeMasraf, isMarketVendor } from "@/lib/masraf/categorize";
import { rowKeyOf, MASRAF_BRANDS } from "@/lib/masraf/brands";
import { matchInvoiceToExpenses, sameInvoice, type ExpenseCandidate } from "@/server/services/masraf/invoice-match";

describe("masraf kategorize — kasa kalemleri (gerçek Ekim 2026 örnekleri)", () => {
  it("işçi parası → ÇALIŞMA ÜCRETİ satırı; yemek/su → YEMEK", () => {
    expect(categorizeExpense({ category: "labor", description: "2 kişi parası" }).category).toBe("ISCI");
    expect(categorizeExpense({ category: "labor", description: "Personel Ödeme (Nur Karaoğlan ve Şahin K)" }).category).toBe("ISCI");
    expect(categorizeExpense({ category: "labor", description: "apo 2 günlük yevmiyesi" }).category).toBe("ISCI");
    expect(rowKeyOf("ISCI")).toBe("CALISMA_UCRETI");
    expect(categorizeExpense({ category: "food", vendor: "Önce Döner Restaurant", description: "2 günlük işçi yemek parası" }).category).toBe("YEMEK");
    expect(categorizeExpense({ category: "food", vendor: "Önce Döner Restaurant", description: "2 günlük işçi parası" }).category).toBe("YEMEK"); // mağaza yemek dedi, restoran
    expect(categorizeExpense({ category: "water", vendor: "Mahmut Sarı", description: "5 damacana su" }).category).toBe("YEMEK");
    expect(categorizeExpense({ category: "other", vendor: "Özerlat Ltd.", description: "özerlat kahve" }).category).toBe("YEMEK");
  });
  it("market zinciri → MARKET (½ temizlik + ½ yemek), mağaza temizlik seçmiş olsa bile", () => {
    expect(isMarketVendor("Metropol / Aytaş Pazarlama Ltd.")).toBe(true);
    expect(isMarketVendor("OYAK Ordu Pazarları")).toBe(true);
    expect(isMarketVendor("Önce Döner Restaurant")).toBe(false);
    expect(categorizeExpense({ category: "supplies", vendor: "Metropol / Aytaş Pazarlama Ltd.", description: "market gideri" }).category).toBe("MARKET");
    expect(categorizeExpense({ category: "cleaning", vendor: "Metroplus Market Ltd.", description: "Temizlik Malzemesi" }).category).toBe("MARKET");
    expect(categorizeExpense({ category: "stationery", vendor: "OYAK Ordu Pazarları", description: "zımba teli a4" }).category).toBe("MARKET");
  });
  it("temizlik / terzi / kırtasiye / diğer", () => {
    expect(categorizeExpense({ category: "cleaning", vendor: "Murat Okur", description: "cam temizliği" }).category).toBe("TEMIZLIK");
    expect(categorizeExpense({ category: "maintenance", vendor: "Murat Okur", description: "cam temizligi ücreti" }).category).toBe("TEMIZLIK");
    expect(categorizeExpense({ category: "supplies", vendor: "Lucky Brothers Trading Ltd.", description: "wc temizliği için eldiven alındı" }).category).toBe("TEMIZLIK");
    expect(categorizeExpense({ category: "tailor", vendor: "Metin Göçer", description: "92x200=18400" }).category).toBe("TERZI");
    expect(categorizeExpense({ category: "tailor", description: "" }).category).toBe("TERZI");
    expect(categorizeExpense({ category: "other", description: "ayakkabıcı" }).category).toBe("TERZI");
    expect(categorizeExpense({ category: "stationery", vendor: "M. Kemal Deniz Şti. Ltd.", description: "flex resim" }).category).toBe("KIRTASIYE");
    const boya = categorizeExpense({ category: "maintenance", vendor: "Hasan Nurçin Trd. Ltd.", description: "Boya Malzemeleri" });
    expect(boya.category).toBe("DIGER");
    expect(boya.needsReview).toBe(true); // "others = kategorisi bulunamayan"
    expect(categorizeExpense({ category: "other", description: "hırdavat gideri hakan bey" }).category).toBe("DIGER");
    expect(categorizeExpense({ category: "glazier", vendor: "Cam Dünyası" }).category).toBe("DIGER");
  });
  it("ana faturalar ve diğer satırlar", () => {
    expect(categorizeExpense({ category: "other", vendor: "KIB-TEK", description: "elektrik faturası" }).category).toBe("ELEKTRIK");
    expect(categorizeExpense({ category: "electricity", vendor: "Kıbrıs Türk Elektrik Kurumu" }).category).toBe("ELEKTRIK");
    expect(categorizeExpense({ category: "internet", vendor: "KKTCELL" }).category).toBe("TELEFON_INTERNET");
    expect(categorizeExpense({ category: "other", description: "kargo ücreti" }).category).toBe("KARGO");
    expect(categorizeExpense({ category: "other", description: "sigorta poliçesi" }).category).toBe("SIGORTA");
    expect(categorizeExpense({ category: "other", vendor: "Alpet", description: "mazot" }).category).toBe("MAZOT");
    expect(categorizeExpense({ category: "other", description: "taksi" }).category).toBe("SEYAHAT");
    expect(categorizeExpense({ category: "rent", description: "orange mall ekim kira" }).category).toBe("KIRA");
    expect(categorizeExpense({ category: "bonus", description: "avans" }).category).toBe("IGNORE");
    expect(categorizeMasraf("pazar parası").category).toBe("IGNORE");
  });
  it("satır düzeni sahibinin Excel'iyle aynı gruplarda", () => {
    const keys = MASRAF_BRANDS.mavi.rows.map((r) => r.key);
    expect(keys.slice(0, 2)).toEqual(["KIRA", "KIRA_STOPAJ"]);
    expect(keys.slice(2, 10)).toEqual(["CALISMA_UCRETI", "YEMEK", "SSK", "YOL", "PRIM", "PERSONEL_STOPAJ", "TAZMINAT", "MESAI"]);
    expect(keys.slice(10, 23)).toEqual(["MUHASEBE", "TERZI", "TELEFON_INTERNET", "POS", "KIRTASIYE", "TEMIZLIK", "SEYAHAT", "KARGO", "ELEKTRIK", "BANKA", "SIGORTA", "DIGER", "DEFOLU"]);
    expect(keys.slice(23)).toEqual(["OFIS_KIRA", "OFIS_MAAS", "OFIS_SSK", "OFIS_DIGER", "MAZOT", "OFIS_SIGORTA"]);
    expect(MASRAF_BRANDS.derimod.rows.map((r) => r.key)).toEqual(keys);
  });
});

describe("fatura fotoğrafı ↔ mağaza masraf kaydı eşleştirme", () => {
  const c = (o: Partial<ExpenseCandidate> & { id: string }): ExpenseCandidate => ({ store_name: "Mavi Mağusa", file_hash: null, vendor: "Erdal Fındık", document_no: null, expense_date: "2026-10-16", amount_try: 940, ...o });
  it("aynı dosya → kesin; belge no + tutar → kesin", () => {
    expect(matchInvoiceToExpenses({ file_hash: "h1", vendor: null, document_no: null, expense_date: null, amount_try: null }, [c({ id: "a", file_hash: "h1" })])?.method).toBe("file_hash");
    const m = matchInvoiceToExpenses({ file_hash: "x", vendor: "ERDAL FINDIK", document_no: "No: 1419", expense_date: "2026-10-16", amount_try: 940 }, [c({ id: "a", document_no: "1418" }), c({ id: "b", document_no: "1419" })]);
    expect(m?.expense.id).toBe("b");
    expect(m?.method).toBe("document_no");
  });
  it("tutar + tarih ±3 gün + satıcı benzerliği → eşleşme; farklı belge no → eşleşmez", () => {
    const m = matchInvoiceToExpenses({ file_hash: "x", vendor: "Erdal Findik", document_no: null, expense_date: "2026-10-17", amount_try: 940 }, [c({ id: "a" })]);
    expect(m?.expense.id).toBe("a");
    expect(m?.method).toBe("vendor_amount");
    expect(matchInvoiceToExpenses({ file_hash: "x", vendor: "Erdal Fındık", document_no: "1419", expense_date: "2026-10-16", amount_try: 940 }, [c({ id: "a", document_no: "1418" })])).toBeNull();
    expect(matchInvoiceToExpenses({ file_hash: "x", vendor: "Erdal Fındık", document_no: null, expense_date: "2026-10-25", amount_try: 940 }, [c({ id: "a" })])).toBeNull(); // 9 gün
    expect(matchInvoiceToExpenses({ file_hash: "x", vendor: "Önce Döner", document_no: null, expense_date: "2026-10-16", amount_try: 940 }, [c({ id: "a" })])).toBeNull(); // başka satıcı
    expect(matchInvoiceToExpenses({ file_hash: "x", vendor: "Erdal Fındık", document_no: null, expense_date: "2026-10-16", amount_try: 941 }, [c({ id: "a" })])).toBeNull(); // tutar farklı
  });
  it("aynı faturanın ikinci fotoğrafı", () => {
    const a = { file_hash: "h1", vendor: "Erdal Fındık", document_no: "1419", expense_date: "2026-10-16", amount_try: 940 };
    expect(sameInvoice(a, { ...a, file_hash: "h2" })).toBe(true);
    expect(sameInvoice(a, { ...a, file_hash: "h2", document_no: "1418" })).toBe(false);
    expect(sameInvoice({ ...a, document_no: null }, { ...a, file_hash: "h2", document_no: null, expense_date: "2026-10-17" })).toBe(false);
  });
});
