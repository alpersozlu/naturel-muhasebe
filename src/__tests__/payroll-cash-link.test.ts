import { describe, expect, it } from "vitest";
import {
  cashEntryShape,
  isPayrollCashCategory,
  matchEmployeeByName,
  staffRoleFromPosition,
} from "@/server/services/payroll/cash-link";

const emp = (id: string, store_id: string, full_name: string, aliases: string[] = [], bank: string | null = null) => ({
  id, store_id, full_name, aliases, bank_account_name: bank,
});

describe("kasadan ödeme → bordro", () => {
  it("yalnız Maaş ve Prim/Avans bordroya düşer", () => {
    expect(isPayrollCashCategory("salary")).toBe(true);
    expect(isPayrollCashCategory("bonus")).toBe(true);
    for (const c of ["rent", "food", "labor", "tailor", "other"]) expect(isPayrollCashCategory(c)).toBe(false);
  });

  it("Prim/Avans → avans kaydı; Maaş → tekil ödeme; ikisi de ödenene eklenir", () => {
    const a = cashEntryShape({ category: "bonus", storeName: "Mavi Magusa", description: "yol parası" });
    expect(a).toEqual({
      kind: "advance", category: null,
      note: "Kasadan nakit avans (Mavi Magusa) — yol parası",
      reference: "DocuFlow kasa avansı",
    });
    const s = cashEntryShape({ category: "salary", storeName: "DERIMOD GIRNE", description: null });
    expect(s).toEqual({
      kind: "payment", category: "single",
      note: "Kasadan nakit maaş ödemesi (DERIMOD GIRNE)",
      reference: "DocuFlow kasa ödemesi",
    });
  });

  it("ünvandan personel rolü", () => {
    expect(staffRoleFromPosition("Mağaza Müdürü")).toBe("manager");
    expect(staffRoleFromPosition("Müdür Yardımcısı")).toBe("assistant_manager");
    expect(staffRoleFromPosition("Satış Asistanı")).toBe("sales_staff");
    expect(staffRoleFromPosition("Depo")).toBe("sales_staff");
    expect(staffRoleFromPosition("Kasiyer")).toBe("sales_staff");
  });

  describe("elle yazılan isim eşleşmesi", () => {
    const kadro = [
      emp("1", "magusa", "Büşra Kaçmaz"),
      emp("2", "girne", "Funda Çalışkan", ["FUNDA CALISKAN"]),
      emp("3", "lefkosa", "Ayşe Yılmaz"),
      emp("4", "magusa", "Ayşe Yılmaz"),
    ];
    it("büyük/küçük harf ve Türkçe karakter farkı eşleşmeyi bozmaz", () => {
      expect(matchEmployeeByName("büşra kaçmaz", "magusa", kadro)?.id).toBe("1");
      expect(matchEmployeeByName("BUSRA KACMAZ", "magusa", kadro)?.id).toBe("1");
    });
    it("takma ad ve banka adı da eşleşir", () => {
      expect(matchEmployeeByName("funda caliskan", "girne", kadro)?.id).toBe("2");
      expect(matchEmployeeByName("HASAN KOKUR", "girne", [emp("9", "girne", "Hasan Kokur Ş.", [], "HASAN KOKUR")])?.id).toBe("9");
    });
    it("aynı isim iki mağazadaysa ödemenin yapıldığı mağaza kazanır", () => {
      expect(matchEmployeeByName("Ayşe Yılmaz", "magusa", kadro)?.id).toBe("4");
      expect(matchEmployeeByName("Ayşe Yılmaz", "lefkosa", kadro)?.id).toBe("3");
    });
    it("başka mağazadan tek aday varsa yine eşleşir", () => {
      expect(matchEmployeeByName("Büşra Kaçmaz", "girne", kadro)?.id).toBe("1");
    });
    it("belirsiz ya da bulunamayan isimde eşleşme yok (tahmin etmez)", () => {
      expect(matchEmployeeByName("Ayşe Yılmaz", "girne", kadro)).toBeNull();
      expect(matchEmployeeByName("Mehmet Demir", "magusa", kadro)).toBeNull();
      expect(matchEmployeeByName("   ", "magusa", kadro)).toBeNull();
      expect(matchEmployeeByName("Büşra", "magusa", kadro)).toBeNull();
    });
  });
});
