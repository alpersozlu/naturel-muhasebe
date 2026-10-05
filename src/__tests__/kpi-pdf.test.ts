import { describe, expect, it } from "vitest";
import { parseKpiPdfPages } from "@/server/services/payroll/performance";

/**
 * "Personel KPI Raporu" Excel'i PDF'e çevrilince tablo SÜTUN SÜTUN sayfalara
 * bölünür; satırlar her sayfada aynı sırayla aynı kişilerdir. Düzen gerçek
 * dosyadan (Mavi Lefkoşa, Eylül 2026, 21 sayfa) alındı; adlar ve tutarlar
 * uydurmadır.
 */
const PAGES = [
  // s.1 — kodlar (ilk satırın temsilci kodu yok)
  "Mağaza Mağaza adı Satış temsilcisi\n9400 KIB ORNEK MAGAZA CD\n9400 KIB ORNEK MAGAZA CD\t94000001\n9400 KIB ORNEK MAGAZA CD\t94000027\n9400 KIB ORNEK MAGAZA CD\t94000038",
  // s.2 — adlar + ilk üçlü
  "Satış temsilcisi Erkek-Denim(TL) Para birimi Erkek-Denim(ADET)\nAyşe Örnek 1,724.13 TRY 1\nAyşe Örnek 46,138.04 TRY 44\nBora Deneme 287,281.20 TRY 168\nCan Kemal Sınama 367,526.06 TRY 213",
  // s.3 — üçlü sayfaya bölünür: TL burada, para birimi ve adet sonraki sayfada
  "Erkek-Gömlek(TL) Para birimi Erkek-Gömlek(ADET) Erkek-Ceket Mont(TL)\n0.00 TRY 0 0.00\n1,267.27 TRY 4 482.79\n93,415.29 TRY 76 52,362.19\n113,834.91 TRY 86 49,162.24",
  "Para birimi Erkek-Ceket Mont(ADET) Erkek-Toplam(TL)\nTRY 0 0.00\nTRY 4 0.00\nTRY 48 0.00\nTRY 47 0.00",
  "Para birimi Erkek-Toplam(ADET) Kadın-Denim(TL) Para birimi Kadın-Denim(ADET)\nTRY 0 0.00 TRY 0\nTRY 0 1,388.05 TRY 13\nTRY 0 169,552.05 TRY 107\nTRY 0 268,005.71 TRY 153",
  // metin sayfaları: sayı sütunu yok, atlanır
  "Mağaza adı Mal Grubu Hiyerarşisi Para birimi\nKIB ORNEK MAGAZA CD TRY\nKIB ORNEK MAGAZA CD TRY\nKIB ORNEK MAGAZA CD TRY\nKIB ORNEK MAGAZA CD TRY",
  "Satış temsilcisi Sezon Tarih (UTC)\nAyşe Örnek\nAyşe Örnek\nBora Deneme\nCan Kemal Sınama",
  "Teknik bilgiler\nKullanıcı ÖRNEK KULLANICI\nOluşturma zamanı 01.10.2026 09:21:14 Avrupa, İstanbul\nFiltrele\nTarih 01.09.2026 03:00:00...30.09.2026 03:00:00",
];

describe("Personel KPI Raporu — PDF hâli", () => {
  it("sayfalara bölünmüş sütunlar kişi kişi birleştirilir", () => {
    const k = parseKpiPdfPages(PAGES);
    expect(k.kind).toBe("kpi_xlsx");
    expect(k.format).toBe("pdf");
    expect(k.store_code).toBe("9400");
    expect(k.store_label).toBe("KIB ORNEK MAGAZA CD");
    expect([k.date_from, k.date_to]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(k.persons.map((p) => [p.code, p.name])).toEqual([
      [null, "Ayşe Örnek"],
      ["94000001", "Ayşe Örnek"],
      ["94000027", "Bora Deneme"],
      ["94000038", "Can Kemal Sınama"],
    ]);
    const bora = k.persons[2]!;
    expect(bora.denim_tl_erkek).toBe(287281.2);
    expect(bora.denim_tl_kadin).toBe(169552.05);
    expect([bora.denim_units_erkek, bora.denim_units_kadin]).toEqual([168, 107]);
    // kategori toplamı: Erkek-Denim + Gömlek + Ceket Mont + Kadın-Denim ("Toplam" sütunları sayılmaz)
    expect(bora.category_tl_total).toBe(602610.73);
    expect(bora.units_total).toBe(168 + 76 + 48 + 107);
    // üç kelimeli ad bölünmez
    expect(k.persons[3]!.name).toBe("Can Kemal Sınama");
    expect(k.persons[3]!.denim_tl_kadin).toBe(268005.71);
  });

  it("Türkçe sayı biçimi de okunur (1.724,13)", () => {
    const tr = PAGES.map((p, i) => (i >= 1 && i <= 4 ? p.replace(/(\d),(\d{3})/g, "$1#$2").replace(/\.(\d{2})(?!\d)/g, ",$1").replace(/#/g, ".") : p));
    const k = parseKpiPdfPages(tr);
    expect(k.persons[2]!.denim_tl_erkek).toBe(287281.2);
    expect(k.persons[1]!.denim_tl_kadin).toBe(1388.05);
  });

  it("satır sayısı tutmayan ya da tanınmayan sütunlu PDF tahmin yürütülmeden reddedilir", () => {
    const short = [...PAGES];
    short[4] = short[4]!.split("\n").slice(0, 4).join("\n"); // bir kişi eksik
    expect(() => parseKpiPdfPages(short)).toThrow(/sütununda 3 satır var, 4 kişi bekleniyordu/);
    const odd = [...PAGES];
    odd[2] = odd[2]!.replace("Erkek-Gömlek(TL)", "Bilinmeyen Sütun Erkek-Gömlek(TL)");
    expect(() => parseKpiPdfPages(odd)).toThrow(/tanınmayan sütun başlığı/);
    const broken = [...PAGES];
    broken[2] = broken[2]!.replace("93,415.29 TRY 76 52,362.19", "93,415.29 TRY 76");
    expect(() => parseKpiPdfPages(broken)).toThrow(/değer sayısı \(3\) sütun sayısını \(4\)/);
  });

  it("denim sütunu yoksa bu bir KPI raporu değildir", () => {
    expect(() => parseKpiPdfPages([PAGES[2]!, PAGES[3]!])).toThrow(/Erkek-Denim\(TL\)/);
  });
});
