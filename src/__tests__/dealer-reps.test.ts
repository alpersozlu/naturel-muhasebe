import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseMaviSapBuffer } from "@/server/services/dealer-report/mavi-sap-parser";

/**
 * Per-salesperson "Net Ciro" from the daily SAP export:
 *   Σ Stok KDV Matrahı − the receipt's Kartuş, shared by each line's Net Tutar.
 * (Calibrated on Girne August/September 2026 — exact to the kuruş.)
 */
const HEADER = [
  "Mağaza", "Belge Tarihi", "İşlem Tipi", "Referans No", "Evrak No", "Miktar", "Malzeme", "Adı", "EAN/UPC Kodu", "Beden", "Miktar",
  "Stok KDV Oranı", "Stok KDV Matrahı", "Stok Kdv Tutarı", "Fiyat", "Satış İskontosu", "Net Tutar", "Tahsilat", "KDV Hariç", "Vergi Tutarı",
  "Toplam Tutar", "Tutar", "Para Birimi", "Banka Kodu", "Tutar", "Hediye Kart", "Kartuş Kart", "Havale", "Diğer",
  "Satış Temsilcisi", "Satış Temsilcisi Adı",
];
const SERIAL_1_SEP = 46266; // 2026-09-01

type Line = { qty: number; matrah: number; net: number; rep: [string, string] };
function receipt(day: number, ref: string, lines: Line[], pay: { cash?: number; card?: number; kartus?: number }, type = "Normal Satış") {
  const total = lines.reduce((s, l) => s + l.net, 0);
  return lines.map((l, i) => {
    const head = i === 0;
    return [
      "9401", SERIAL_1_SEP + day - 1, type, ref, null, head ? lines.length : null, "M00", "ürün", null, null, l.qty,
      16, l.matrah, l.net - l.matrah, l.net, 0, l.net, head ? "Kredi" : null, null, null,
      head ? total : null, head ? (pay.cash ?? 0) : null, "TRY", head ? "BANKA" : null, head ? (pay.card ?? 0) : null,
      0, pay.kartus ?? 0, null, null, // Kartuş repeats on every line of the receipt
      l.rep[0], l.rep[1],
    ];
  });
}
function workbook(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), "SAPUI5 dışa aktarımı");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const MARAL: [string, string] = ["94010020", "Maral Rahmanova"];
const ENES: [string, string] = ["94010049", "Enes Demir"];

describe("bayi gün sonu — satış temsilcisi bazında Net Ciro", () => {
  it("matrah − Kartuş; Kartuş fişe bir kez, satırlara Net Tutar payıyla", () => {
    const buf = workbook([
      // one receipt, two salespeople, 300 ₺ Kartuş: Maral 2.320 of 3.480 net → 200 ₺, Enes 1.160 → 100 ₺
      ...receipt(1, "R1", [
        { qty: 1, matrah: 2000, net: 2320, rep: MARAL },
        { qty: 1, matrah: 1000, net: 1160, rep: ENES },
      ], { card: 3180, kartus: 300 }),
      ...receipt(1, "R2", [{ qty: 2, matrah: 500, net: 580, rep: ENES }], { cash: 580 }),
    ]);
    const report = parseMaviSapBuffer(buf);
    expect(report.store_code).toBe("9401");
    expect(report.days).toHaveLength(1);
    const day = report.days[0]!;
    expect(day.loyalty).toBe(300); // once per receipt, not once per line
    expect(day.net_ex_vat).toBe(3500);
    const maral = day.reps.find((r) => r.code === "94010020")!;
    const enes = day.reps.find((r) => r.code === "94010049")!;
    expect(maral.kartus).toBe(200);
    expect(maral.net_ciro).toBe(1800);
    expect(enes.kartus).toBe(100);
    expect(enes.net_ciro).toBe(1400); // 1.000 + 500 − 100
    expect(enes.units).toBe(3);
    // the people add up to the store: Σ matrah − Σ Kartuş
    expect(day.reps.reduce((s, r) => s + r.net_ciro, 0)).toBe(3500 - 300);
  });

  it("iade eksi yazılır; günler ayrı tutulur", () => {
    const buf = workbook([
      ...receipt(1, "R1", [{ qty: 1, matrah: 1000, net: 1160, rep: MARAL }], { cash: 1160 }),
      ...receipt(2, "R2", [{ qty: -1, matrah: -1000, net: -1160, rep: MARAL }], { cash: -1160 }, "Refereanslı İade"),
      ...receipt(2, "R3", [{ qty: 1, matrah: 400, net: 464, rep: MARAL }], { cash: 464 }),
    ]);
    const report = parseMaviSapBuffer(buf);
    expect(report.days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-02"]);
    expect(report.days[0]!.reps[0]!.net_ciro).toBe(1000);
    expect(report.days[1]!.reps[0]!.net_ciro).toBe(-600);
    expect(report.days[1]!.reps[0]!.units).toBe(0);
  });

  it("temsilci kolonları yoksa günün rakamları yine okunur, kişi listesi boş kalır", () => {
    const cut = HEADER.length - 2;
    const rows = receipt(1, "R1", [{ qty: 1, matrah: 1000, net: 1160, rep: MARAL }], { cash: 1160 }).map((r) => r.slice(0, cut));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER.slice(0, cut), ...rows]), "S");
    const report = parseMaviSapBuffer(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    expect(report.days[0]!.net_sales).toBe(1160);
    expect(report.days[0]!.reps).toEqual([]);
  });
});
