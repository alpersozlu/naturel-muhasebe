import { describe, expect, it } from "vitest";
import { groupByStore, selectedItems, sumAmounts } from "@/components/payroll/batch-select";
import { batchTitle } from "@/server/services/payroll/rules";

/**
 * Ödeme 2 nakit MAĞAZA MAĞAZA kaydedilir (sahibi, 05.10.2026: "mağaza mağaza
 * kaydedebilirsem daha rahat olur, mağazayı ödediğimde tıklayayım").
 */
const rows = [
  { line_id: "g1", store_name: "Mavi Girne" },
  { line_id: "g2", store_name: "Mavi Girne" },
  { line_id: "l1", store_name: "Mavi Lefkosa" },
  { line_id: "l2", store_name: "Mavi Lefkosa" },
  { line_id: "d1", store_name: "DERIMOD GIRNE" },
];
const checked = { g1: true, g2: true, l1: true, l2: false, d1: true };
const amounts = { g1: 10_142.52, g2: 21_452.45, l1: 8_537.4, l2: 10_000, d1: 0 };

describe("mağaza mağaza nakit kaydı — seçim", () => {
  it("bir mağazanın düğmesi yalnız o mağazanın seçili kişilerini kaydeder", () => {
    expect(selectedItems(rows, checked, amounts, "Mavi Girne")).toEqual([
      { line_id: "g1", amount: 10_142.52 },
      { line_id: "g2", amount: 21_452.45 },
    ]);
  });

  it("seçili olmayan ya da tutarı sıfır olan kişi kayda girmez", () => {
    // l2 seçili değil (ör. gönderilmemiş talimat uyarısı), d1'in tutarı 0
    expect(selectedItems(rows, checked, amounts, "Mavi Lefkosa")).toEqual([{ line_id: "l1", amount: 8_537.4 }]);
    expect(selectedItems(rows, checked, amounts, "DERIMOD GIRNE")).toEqual([]);
  });

  it("mağaza verilmezse seçili herkes gelir; mağazaların toplamı genel toplama eşittir", () => {
    const all = selectedItems(rows, checked, amounts);
    expect(all.map((i) => i.line_id)).toEqual(["g1", "g2", "l1"]);
    const perStore = ["Mavi Girne", "Mavi Lefkosa", "DERIMOD GIRNE"].map((s) => sumAmounts(selectedItems(rows, checked, amounts, s)));
    expect(perStore).toEqual([31_594.97, 8_537.4, 0]);
    expect(sumAmounts(all)).toBe(40_132.37);
    expect(sumAmounts(perStore.map((amount) => ({ amount })))).toBe(sumAmounts(all));
  });

  it("tutar girilmemiş (boş) satır kayda girmez", () => {
    expect(selectedItems(rows, { g1: true }, { g1: undefined }, "Mavi Girne")).toEqual([]);
  });
});

describe("mağaza mağaza nakit kaydı — gruplama", () => {
  const order = ["Mavi Girne", "Mavi Lefkosa", "DERIMOD GIRNE"];

  it("mağaza sırası ve mağaza içi kişi sırası korunur", () => {
    const g = groupByStore(rows, order);
    expect(g.map((x) => x.store)).toEqual(order);
    expect(g.map((x) => x.rows.map((r) => r.line_id))).toEqual([["g1", "g2"], ["l1", "l2"], ["d1"]]);
  });

  it("işlenen mağazanın satırları kalkar, mağaza listede kalır (ödendi bilgisi için)", () => {
    const left = rows.filter((r) => r.store_name !== "Mavi Girne");
    const g = groupByStore(left, order);
    expect(g.map((x) => [x.store, x.rows.length])).toEqual([
      ["Mavi Girne", 0],
      ["Mavi Lefkosa", 2],
      ["DERIMOD GIRNE", 1],
    ]);
  });

  it("bir mağazada kısmen ödeme: kalan kişi o mağazada görünmeye devam eder", () => {
    const left = rows.filter((r) => r.line_id !== "l1");
    expect(groupByStore(left, order).find((x) => x.store === "Mavi Lefkosa")?.rows.map((r) => r.line_id)).toEqual(["l2"]);
  });

  it("sırada olmayan mağaza sona eklenir, hiçbir satır kaybolmaz", () => {
    const g = groupByStore(rows, ["Mavi Lefkosa"]);
    expect(g.map((x) => x.store)).toEqual(["Mavi Lefkosa", "Mavi Girne", "DERIMOD GIRNE"]);
    expect(g.reduce((s, x) => s + x.rows.length, 0)).toBe(rows.length);
  });
});

describe("liste başlığı", () => {
  const base = { period: "Eylül 2026", kind: "Odeme 2 (Mesai-Komisyon-Prim)", pay_date: "2026-10-05" };

  it("tek mağazalık nakit listesinin başlığında mağaza adı vardır", () => {
    expect(batchTitle({ ...base, channel: "cash", stores: ["Mavi Girne"] })).toBe(
      "Eylül 2026 · Odeme 2 (Mesai-Komisyon-Prim) · Nakit · Mavi Girne · 2026-10-05"
    );
  });

  it("birden çok mağazayı kapsayan nakit listesi ve banka talimatı eski başlığı taşır", () => {
    expect(batchTitle({ ...base, channel: "cash", stores: ["Mavi Girne", "Mavi Lefkosa"] })).toBe(
      "Eylül 2026 · Odeme 2 (Mesai-Komisyon-Prim) · Nakit · 2026-10-05"
    );
    expect(batchTitle({ ...base, kind: "Odeme 1 (Kalan Maas)", channel: "garanti", stores: ["Mavi Girne"] })).toBe(
      "Eylül 2026 · Odeme 1 (Kalan Maas) · Garanti · 2026-10-05"
    );
    expect(batchTitle({ ...base, kind: "Odeme 1 (Kalan Maas)", channel: "ziraat", stores: ["Mavi Girne"] })).toBe(
      "Eylül 2026 · Odeme 1 (Kalan Maas) · Ziraat · 2026-10-05"
    );
  });
});
