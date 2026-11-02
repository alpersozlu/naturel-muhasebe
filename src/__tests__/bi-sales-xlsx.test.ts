import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { biPdfPagesOf, mergeBiPdf, parsePerformanceFile, type BiPdfParsed } from "@/server/services/payroll/performance";

// Sahibi 02.11.2026: BI "Çalışan Satış KPI" sayfası Excel tablosu olarak geldi
// (Lefkoşa Ekim) — "Dosya tanınmadı" diye reddediliyordu.
async function sheet(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Table 7");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEAD = ["Çalışan", "Çalışan Net TL %", "Net TL", "UPT", "Sepet TL", "2+1'li İşlem", "Tekli İşlem", "İşlem Adet", "Denim Adet", "Üst Alt", "Online / Offline"];

describe("BI satış tablosu (Excel)", () => {
  it("kişileri, kesir ve yüzde metnini, genel toplamı okur; yalnız satış sayfasıdır", async () => {
    const buf = await sheet([
      HEAD,
      ["94000036 - Fırat Öner", "23.1%", 2256016, 2.72, 2848.5, 0.337, 0.355, 792, 424, 1.79, ""],
      ["94000004 - Hakan Kokur", "0.1%", 5612, 3.5, 2806, "50,0%", null, 2, null, 2.5, ""],
      ["Genel Toplam", "100.0%", 9769995, 2.85, 3037.9, 0.284, 0.413, 3216, 2010, 1.67],
    ]);
    const r = await parsePerformanceFile("Çalışan satış kpı raporu.xlsx", buf);
    const p = r.parsed as BiPdfParsed;
    expect(p.kind).toBe("bi_pdf");
    expect(p.format).toBe("xlsx");
    expect(p.store_code).toBe("9400");
    expect(biPdfPagesOf(p)).toEqual({ sales: true, category: false });
    expect(p.persons).toHaveLength(2);
    expect(p.persons[0]).toMatchObject({ code: "94000036", name: "Fırat Öner", net_tl: 2256016, upt: 2.72, single_pct: 0.355, transactions: 792, denim_units: 424 });
    expect(p.persons[1]!.two_plus_one_pct).toBe(0.5);
    expect(p.total).toMatchObject({ net_tl: 9769995, upt: 2.85, single_pct: 0.413 });
    expect(r.genuine).toBe(false); // SAP'nin özgün dışa aktarımı değil
  });

  it("kayıtlı kategori PDF'iyle birleşince iki sayfa da tamam olur", async () => {
    const sales = (await parsePerformanceFile("s.xlsx", await sheet([HEAD, ["94000036 - Fırat Öner", "", 2256016, 2.72, 2848.5, 0.337, 0.355, 792, 424, 1.79, ""]]))).parsed as BiPdfParsed;
    const category: BiPdfParsed = {
      kind: "bi_pdf",
      store_code: "9400",
      persons: [{ code: "94000036", name: "Fırat Öner", net_tl: null, upt: null, sepet: null, two_plus_one_pct: null, single_pct: null, transactions: null, denim_units: null, units_total: 2152, erkek_denim_units: 209, kadin_denim_units: 201 }],
      total: { net_tl: null, upt: null, sepet: null, two_plus_one_pct: null, single_pct: null, transactions: null, denim_units: null, units_total: 9155, erkek_denim_units: 1095, kadin_denim_units: 866 },
      category_layout_ok: true,
      has_sales: false,
      has_category: true,
      month: 10,
      year: 2026,
    };
    const m = mergeBiPdf(category, sales);
    expect(biPdfPagesOf(m)).toEqual({ sales: true, category: true });
    expect(m.persons[0]).toMatchObject({ net_tl: 2256016, kadin_denim_units: 201, units_total: 2152 });
    expect(m.month).toBe(10);
  });

  it("tanınmayan tabloda hata mesajı BI satış tablosunu da sayar", async () => {
    await expect(parsePerformanceFile("x.xlsx", await sheet([["Ad", "Tutar"], ["a", 1]]))).rejects.toThrow("BI Çalışan Satış KPI tablosu");
  });
});
