import { describe, expect, it } from "vitest";
import { noSalesBlocker, todayIstanbul, type NoSalesFacts } from "@/server/services/daily-record";

/** Derimod Girne 04.10.2026: gün kaydı yok, Nebim'de satır yok. */
function empty(over: Partial<NoSalesFacts> = {}): NoSalesFacts {
  return {
    date: "2026-10-04",
    today: "2026-11-10",
    status: null,
    no_sales: false,
    merged: false,
    documents: 0,
    manual_invoices: 0,
    corporate_purchases: 0,
    typed_amounts: 0,
    nebim_lines: 0,
    nebim_net: 0,
    ...over,
  };
}

describe("satış olmadı — gün 0,00 ile kapanır", () => {
  it("hiç kaydı olmayan, Nebim'de satırı olmayan geçmiş gün kapatılabilir (04.10.2026 Girne)", () => {
    expect(noSalesBlocker(empty())).toBeNull();
  });

  it("içi boş taslak gün de kapatılabilir; bugün de kapatılabilir", () => {
    expect(noSalesBlocker(empty({ status: "draft" }))).toBeNull();
    expect(noSalesBlocker(empty({ date: "2026-11-10" }))).toBeNull();
  });

  it("gelecek gün kapatılamaz", () => {
    expect(noSalesBlocker(empty({ date: "2026-11-11" }))).toContain("gelmemiş");
  });

  it("Nebim'de satış varsa kapatılamaz; tutar kuruşlu yazılır", () => {
    const msg = noSalesBlocker(empty({ nebim_lines: 19, nebim_net: 54926.32 }));
    expect(msg).toContain("19 satır");
    expect(msg).toContain("54.926,32 ₺");
  });

  it("yüklenmiş belge, el faturası, kurumsal alışveriş ya da girilmiş tutar varsa kapatılamaz", () => {
    expect(noSalesBlocker(empty({ status: "draft", documents: 2 }))).toContain("2 belge");
    expect(noSalesBlocker(empty({ status: "draft", manual_invoices: 1 }))).toContain("el faturası");
    expect(noSalesBlocker(empty({ status: "draft", corporate_purchases: 1 }))).toContain("kurumsal");
    expect(noSalesBlocker(empty({ status: "draft", typed_amounts: 500 }))).toContain("nakit");
  });

  it("kilitli, zaten satışsız kapatılmış ya da birleşmedeki gün kapatılamaz", () => {
    expect(noSalesBlocker(empty({ status: "locked" }))).toContain("kilitli");
    expect(noSalesBlocker(empty({ status: "locked", no_sales: true }))).toContain("zaten");
    expect(noSalesBlocker(empty({ status: "draft", merged: true }))).toContain("birleşme");
  });

  it("bugün İstanbul saatine göre hesaplanır (UTC 21:30 = ertesi gün 00:30)", () => {
    expect(todayIstanbul(new Date("2026-11-09T21:30:00.000Z"))).toBe("2026-11-10");
    expect(todayIstanbul(new Date("2026-11-10T20:59:00.000Z"))).toBe("2026-11-10");
  });
});
