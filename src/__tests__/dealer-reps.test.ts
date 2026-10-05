import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { looksLikeDenim, mergedDealerDay, parseMaviSapBuffer, pickDay, pickRange } from "@/server/services/dealer-report/mavi-sap-parser";

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

type Line = { qty: number; matrah: number; net: number; rep: [string, string]; product?: [string, string] };
function receipt(day: number, ref: string, lines: Line[], pay: { cash?: number; card?: number; kartus?: number }, type = "Normal Satış") {
  const total = lines.reduce((s, l) => s + l.net, 0);
  return lines.map((l, i) => {
    const head = i === 0;
    return [
      "9401", SERIAL_1_SEP + day - 1, type, ref, null, head ? lines.length : null, l.product?.[0] ?? "M0620155-900003", l.product?.[1] ?? "POLO TİŞÖRT Siyah, M", null, null, l.qty,
      16, l.matrah, l.net - l.matrah, l.net, 0, l.net, head ? "Kredi" : null, null, null,
      head ? total : null, head ? (pay.cash ?? 0) : null, "TRY", head ? "BANKA" : null, head ? (pay.card ?? 0) : null,
      0, pay.kartus ?? 0, null, null, // Kartuş repeats on every line of the receipt
      l.rep[0], l.rep[1],
    ];
  });
}
function workbook(rows: unknown[][], header: string[] = HEADER): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "SAPUI5 dışa aktarımı");
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

  it("denim tahmini: fit adlı pantolon/şort/etek satırları; Kartuş payı düşülmüş", () => {
    expect(looksLikeDenim("M0042487866071", "JAKE Mavi Black, 32/32")).toBe(true);
    expect(looksLikeDenim("M0428123456789", "TIM 90's Used")).toBe(true); // erkek denim şort
    expect(looksLikeDenim("M1010547-87822007", "SIENA Dark Used")).toBe(true);
    expect(looksLikeDenim("M1421000-1", "TAYLOR SHORT Dark")).toBe(true); // İngilizce SHORT — denim şort
    expect(looksLikeDenim("M0010547-70219006", "DOKUMA PANTOLON Jet Black, 32")).toBe(false);
    expect(looksLikeDenim("M1420392-83859005", "Modelli dokuma şort White Pepper, L")).toBe(false);
    expect(looksLikeDenim("M1310583-91753002", "DOKUMA MINI ELBISE Black")).toBe(false);
    expect(looksLikeDenim("M0620155-900003", "POLO TİŞÖRT Siyah, M")).toBe(false); // tişört grubu
    expect(looksLikeDenim("M0110154-1", "DRAKE Mid Brushed")).toBe(false); // ceket grubu

    const buf = workbook([
      ...receipt(1, "R1", [
        { qty: 1, matrah: 2000, net: 2320, rep: MARAL, product: ["M0042487866071", "JAKE Mavi Black"] },
        { qty: 1, matrah: 1000, net: 1160, rep: MARAL },
      ], { card: 3180, kartus: 300 }),
    ]);
    const maral = parseMaviSapBuffer(buf).days[0]!.reps[0]!;
    expect(maral.net_ciro).toBe(2700);
    expect(maral.denim).toBe(1800); // 2.000 − 300 × 2.320/3.480
    expect(maral.denim_units).toBe(1);
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

  it("kasa birleşmesi: birleşik günler tek rakam olur (pickRange)", () => {
    // 1 Ekim kasa kapatılamadı; 2 Ekim dosyası iki günü de taşıyor (+ aralık dışı 30 Eylül).
    const day = (n: number) => new Date(Date.UTC(2026, 8, n)); // SERIAL_1_SEP = 1 Eylül → gün n
    const buf = workbook([
      ...receipt(30, "R0", [{ qty: 1, matrah: 5000, net: 5800, rep: ENES }], { cash: 5800 }),
      ...receipt(31, "R1", [{ qty: 1, matrah: 1000, net: 1160, rep: MARAL }], { cash: 1160 }),
      ...receipt(31, "R2", [{ qty: 1, matrah: 2000, net: 2320, rep: ENES }], { card: 2020, kartus: 300 }),
      ...receipt(32, "R3", [{ qty: 2, matrah: 400, net: 464, rep: MARAL }], { card: 464 }),
    ]);
    const report = parseMaviSapBuffer(buf);
    expect(report.days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);

    const both = pickRange(report, day(31), day(32))!;
    expect(both.date.toISOString().slice(0, 10)).toBe("2026-10-02"); // özetin durduğu son gün
    expect(both.net_sales).toBe(1160 + 2320 + 464);
    expect(both.cash).toBe(1160);
    expect(both.card).toBe(2020 + 464);
    expect(both.loyalty).toBe(300);
    expect(both.transaction_count).toBe(3);
    // günlerin toplamına eşit
    const d1 = pickDay(report, day(31))!;
    const d2 = pickDay(report, day(32))!;
    expect(both.net_sales).toBe(d1.net_sales + d2.net_sales);
    // kişiler koduyla birleşir
    expect(both.reps.find((r) => r.code === "94010020")!.net_ciro).toBe(1400);
    expect(both.reps.find((r) => r.code === "94010020")!.units).toBe(3);
    expect(both.reps.find((r) => r.code === "94010049")!.net_ciro).toBe(1700);

    // kasa bütün gün kapalıysa o güne ait satır olmaz — olanlar toplanır
    expect(pickRange(report, day(32), day(33))!.net_sales).toBe(464);
    expect(pickRange(report, day(33), day(34))).toBeNull();
  });

  it("kasa birleşmesi: grubun SAP toplamı tek günlük ya da aralık dosyalarından, her gün bir kez", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 8, n));
    const oct1 = receipt(31, "R1", [{ qty: 1, matrah: 1000, net: 1160, rep: MARAL }], { cash: 1160 });
    const oct2 = receipt(32, "R3", [{ qty: 2, matrah: 400, net: 464, rep: MARAL }], { card: 464 });
    const stored1 = { net_sales: 1160, loyalty: 0, gift_card: 0, cash: 1160, card: 0, wire: 0, other: 0, refund_total: 0, transaction_count: 1, line_count: 1, refund_count: 0 };

    // (a) aralık dosyası son güne yüklendi, 1 Ekim'in kendi dosyası yok → ikisi de dosyadan
    const range = parseMaviSapBuffer(workbook([...oct1, ...oct2]));
    const a = mergedDealerDay(range, day(32), [{ iso: "2026-10-01", own: null }])!;
    expect(a.day.net_sales).toBe(1624);
    expect(a.file_days).toEqual(["2026-10-01", "2026-10-02"]);
    expect(a.from_own_reports).toEqual([]);

    // (b) mağazanın alışkın olduğu yol: her günün kendi tek günlük dosyası
    const single = parseMaviSapBuffer(workbook([...oct2]));
    const b = mergedDealerDay(single, day(32), [{ iso: "2026-10-01", own: stored1 }])!;
    expect(b.day.net_sales).toBe(1624);
    expect(b.day.cash).toBe(1160);
    expect(b.day.card).toBe(464);
    expect(b.day.transaction_count).toBe(2);
    expect(b.from_own_reports).toEqual(["2026-10-01"]);

    // (c) aralık dosyası + 1 Ekim'in kendi dosyası da var → 1 Ekim İKİ KEZ sayılmaz
    const c = mergedDealerDay(range, day(32), [{ iso: "2026-10-01", own: stored1 }])!;
    expect(c.day.net_sales).toBe(1624);
    expect(c.file_days).toEqual(["2026-10-02"]);

    // (d) son günün satırı dosyada yoksa kabul edilmez (yanlış günün dosyası)
    expect(mergedDealerDay(parseMaviSapBuffer(workbook([...oct1])), day(32), [{ iso: "2026-10-01", own: null }])).toBeNull();
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

  /**
   * SAP'nin iki ay sonu kaynağı ortak fişi farklı işler (05.10.2026'da ölçüldü):
   * BI Kartuş'u herkese payı oranında yazar (= net_ciro); IT POS kişi tablosu
   * yalnız "Sıra No" 1 olan satırın temsilcisinden düşer. itpos_extra, IT POS'un
   * o kişide net_ciro'nun üstünde göstereceği tutardır.
   */
  const HEADER_SEQ = [...HEADER, "Sıra No"];
  const withSeq = (rows: unknown[][], seqs: number[]) => rows.map((r, i) => [...r, seqs[i]!]);
  const EMRE: [string, string] = ["94010050", "Emre Atılgan"];

  it("ortak fişte IT POS, Kartuş payını yalnız ilk okutulan ürünün temsilcisinden düşer (Girne 19.09.2026)", () => {
    const buf = workbook(
      [
        // dosyadaki satır sırası okutma sırası değildir: önce Emre'nin satırı (Sıra No 2), sonra Maral'ınki (Sıra No 1)
        ...withSeq(
          receipt(19, "R1", [
            { qty: 1, matrah: 431.03, net: 499.99, rep: EMRE },
            { qty: 1, matrah: 948.27, net: 1099.99, rep: MARAL },
          ], { card: 1479.98, kartus: 120 }),
          [2, 1]
        ),
        // tek temsilcili Kartuşlu fiş ve Kartuşsuz ortak fiş: fazlalık doğurmaz
        ...withSeq(receipt(19, "R2", [{ qty: 1, matrah: 1000, net: 1160, rep: EMRE }], { card: 1060, kartus: 100 }), [1]),
        ...withSeq(
          receipt(19, "R3", [
            { qty: 1, matrah: 500, net: 580, rep: MARAL },
            { qty: 1, matrah: 500, net: 580, rep: EMRE },
          ], { cash: 1160 }),
          [1, 2]
        ),
      ],
      HEADER_SEQ
    );
    const day = parseMaviSapBuffer(buf).days[0]!;
    const maral = day.reps.find((r) => r.code === "94010020")!;
    const emre = day.reps.find((r) => r.code === "94010050")!;
    // pay oranlı (BI): Maral 82,50 · Emre 37,50 (+ kendi fişinden 100)
    expect(maral.kartus).toBeCloseTo(82.5, 2);
    expect(emre.kartus).toBeCloseTo(137.5, 2);
    // IT POS: ilk ürün Maral'ın → onun payı düşülür, Emre'nin 37,50'si düşülmez
    expect(maral.itpos_extra).toBe(0);
    expect(emre.itpos_extra).toBeCloseTo(37.5, 2);
    expect(emre.net_ciro + emre.itpos_extra!).toBeCloseTo(431.03 + 1000 + 500 - 100, 2);
  });

  it("Sıra No sütunu yoksa ortak Kartuşlu fişte düşülmeyen pay bilinmez (null); ortak fiş yoksa 0'dır", () => {
    const shared = workbook([
      ...receipt(1, "R1", [
        { qty: 1, matrah: 2000, net: 2320, rep: MARAL },
        { qty: 1, matrah: 1000, net: 1160, rep: ENES },
      ], { card: 3180, kartus: 300 }),
    ]);
    expect(parseMaviSapBuffer(shared).days[0]!.reps.map((r) => r.itpos_extra)).toEqual([null, null]);
    const alone = workbook([...receipt(1, "R1", [{ qty: 1, matrah: 2000, net: 2320, rep: MARAL }], { card: 2020, kartus: 300 })]);
    expect(parseMaviSapBuffer(alone).days[0]!.reps[0]!.itpos_extra).toBe(0);
  });

  it("birleşik günlerde düşülmeyen pay da toplanır", () => {
    const buf = workbook(
      [
        ...withSeq(
          receipt(1, "R1", [
            { qty: 1, matrah: 1000, net: 1160, rep: MARAL },
            { qty: 1, matrah: 1000, net: 1160, rep: ENES },
          ], { card: 2120, kartus: 200 }),
          [1, 2]
        ),
        ...withSeq(
          receipt(2, "R2", [
            { qty: 1, matrah: 1000, net: 1160, rep: MARAL },
            { qty: 3, matrah: 3000, net: 3480, rep: ENES },
          ], { card: 4240, kartus: 400 }),
          [1, 2]
        ),
      ],
      HEADER_SEQ
    );
    const report = parseMaviSapBuffer(buf);
    const both = pickRange(report, new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 2)))!;
    expect(both.reps.find((r) => r.code === "94010049")!.itpos_extra).toBe(400); // 100 + 300
    expect(both.reps.find((r) => r.code === "94010020")!.itpos_extra).toBe(0);
  });
});
