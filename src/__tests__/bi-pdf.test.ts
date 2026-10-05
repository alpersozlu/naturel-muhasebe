import { describe, expect, it } from "vitest";
import { biPdfPagesOf, mergeBiPdf, parseBiCategoryGrid, type BiPdfParsed, type PdfItem } from "@/server/services/payroll/performance";

/**
 * BI "Çalışan Performans Raporu" — kategori sayfası KONUMLA okunur: hangi
 * sütunların göründüğü mağazaya göre değişir (Lefkoşa'da Erkek-Ceket ve Çocuk
 * reyonu var, Girne'de yok) ve boş hücre metinde yer tutmaz. Düzen gerçek
 * dosyalardan (Lefkoşa ve Girne, Eylül 2026); adlar uydurma.
 */
const it_ = (s: string, cx: number, y: number): PdfItem => {
  const w = s.length * 9;
  return { s, x: cx - w / 2, y, w };
};
/** sayılar sağa yaslıdır: başlığın merkezinden biraz sağda durur */
const num = (v: number | string, cx: number, y: number): PdfItem => it_(String(v), cx + 8, y);
const label = (s: string, y: number): PdfItem => ({ s, x: 28.5, y, w: s.length * 9 });

// Lefkoşa düzeni: Erkek (Aksesuar, Ceket, Denim, Gömlek, Toplam) · Kadın (Aksesuar, Denim, Etek, Toplam) · Çocuk (Denim, Penye, Toplam) · Toplam
const C = { eAks: 390, eCek: 468, eDen: 540, eGom: 620, eTop: 1030, kAks: 1110, kDen: 1255, kEtek: 1335, kTop: 1815, cDen: 1895, cPen: 2080, cTop: 2250, grand: 2326 };
const header = (withKids: boolean): PdfItem[] => [
  // süzgeç satırı da "Çalışan" içerir ama "Toplam" içermez — başlık sanılmamalı
  it_("Yıl", 280, 1019), it_("Tarih", 495, 1019), it_("Çalışan", 840, 1019),
  it_("Bölüm", 190, 672), it_("Erkek", 720, 672), it_("Kadın", 1470, 672), ...(withKids ? [it_("Çocuk", 2080, 672)] : []), it_("Toplam", C.grand, 672),
  it_("Çalışan", 190, 642), it_("Aksesuar", C.eAks, 642), it_("Ceket", C.eCek, 642), it_("Denim", C.eDen, 642), it_("Gömlek", C.eGom, 642), it_("Toplam", C.eTop, 642),
  it_("Aksesuar", C.kAks, 642), it_("Denim", C.kDen, 642), it_("Etek,", C.kEtek, 642), it_("Toplam", C.kTop, 642),
  ...(withKids ? [it_("Denim", C.cDen, 642), it_("Penye", C.cPen, 642), it_("Toplam", C.cTop, 642)] : []),
  // başlığın ikinci satırı
  it_("All", C.eDen, 620), it_("All", C.kDen, 620), it_("Elbise", C.kEtek, 620),
];

describe("BI kategori sayfası — konumla okuma", () => {
  it("her sayı kendi sütununa düşer; boş hücreli satırda denim yanlış sütundan okunmaz", () => {
    const items: PdfItem[] = [
      ...header(true),
      // bütün hücreler dolu
      label("94000044 - Ayşe Örnek", 578),
      num(110, C.eAks, 578), num(2, C.eCek, 578), num(198, C.eDen, 578), num(90, C.eGom, 578), num(400, C.eTop, 578),
      num(88, C.kAks, 578), num(140, C.kDen, 578), num(19, C.kEtek, 578), num(247, C.kTop, 578),
      num(11, C.cDen, 578), num(37, C.cPen, 578), num(48, C.cTop, 578), num(695, C.grand, 578),
      // Erkek-Ceket ve Kadın-Etek boş: sıradan sayan okuyucu 101'i "Ceket" sanardı
      label("94000036 - Bora Deneme", 548),
      num(70, C.eAks, 548), num(101, C.eDen, 548), num(36, C.eGom, 548), num(207, C.eTop, 548),
      num(41, C.kAks, 548), num(72, C.kDen, 548), num(113, C.kTop, 548),
      num(4, C.cDen, 548), num(4, C.cTop, 548), num(324, C.grand, 548),
      // yalnız birkaç hücre: kadın aksesuar ve çocuk penye
      label("94000043 - Can Kemal Sınama", 518),
      num(7, C.kAks, 518), num(7, C.kTop, 518), num(3, C.cPen, 518), num(3, C.cTop, 518), num(10, C.grand, 518),
      // kodsuz satır (ad yok) atlanır
      num(1, C.eDen, 488), num(1, C.eTop, 488), num(1, C.grand, 488),
      label("Genel Toplam", 458),
      num(180, C.eAks, 458), num(2, C.eCek, 458), num(300, C.eDen, 458), num(126, C.eGom, 458), num(608, C.eTop, 458),
      num(136, C.kAks, 458), num(212, C.kDen, 458), num(19, C.kEtek, 458), num(367, C.kTop, 458),
      num(15, C.cDen, 458), num(40, C.cPen, 458), num(55, C.cTop, 458), num("1.030", C.grand, 458),
    ];
    const g = parseBiCategoryGrid(items);
    expect(g.ok).toBe(true);
    expect(g.rows.size).toBe(3);
    expect(g.rows.get("94000044")).toMatchObject({ name: "Ayşe Örnek", units_total: 695, erkek_denim_units: 198, kadin_denim_units: 140, cocuk_denim_units: 11 });
    expect(g.rows.get("94000036")).toMatchObject({ units_total: 324, erkek_denim_units: 101, kadin_denim_units: 72, cocuk_denim_units: 4 });
    expect(g.rows.get("94000043")).toMatchObject({ units_total: 10, erkek_denim_units: 0, kadin_denim_units: 0, cocuk_denim_units: 0 });
    expect(g.total).toMatchObject({ units_total: 1030, erkek_denim_units: 300, kadin_denim_units: 212, cocuk_denim_units: 15 });
  });

  it("KPI raporunda olmayan adetler de okunur: erkek + kadın sweatshirt ve çocuk reyonu toplamı", () => {
    // Güzelyurt müdürü, Eylül 2026: 60 adet − 2 sweatshirt − 2 çocuk = 56 (KPI raporundaki adet)
    const S = { eSw: 890, kSw: 1675 };
    const g = parseBiCategoryGrid([
      ...header(true),
      it_("Sweatshirt", S.eSw, 642), it_("Sweatshirt", S.kSw, 642),
      label("94000021 - Elif Örnek", 578),
      num(30, C.eAks, 578), num(1, C.eDen, 578), num(1, S.eSw, 578), num(32, C.eTop, 578),
      num(21, C.kAks, 578), num(4, C.kDen, 578), num(1, S.kSw, 578), num(26, C.kTop, 578),
      num(2, C.cPen, 578), num(2, C.cTop, 578), num(60, C.grand, 578),
    ]);
    expect(g.ok).toBe(true);
    expect(g.rows.get("94000021")).toMatchObject({ units_total: 60, sweatshirt_units: 2, cocuk_units: 2, erkek_denim_units: 1, kadin_denim_units: 4 });
  });

  it("çocuk reyonu olmayan mağazada (Girne düzeni) çocuk denimi 0'dır", () => {
    const g = parseBiCategoryGrid([
      ...header(false),
      label("94010050 - Deniz Örnek", 578),
      num(187, C.eAks, 578), num(150, C.eDen, 578), num(41, C.eGom, 578), num(378, C.eTop, 578),
      num(108, C.kAks, 578), num(88, C.kDen, 578), num(12, C.kEtek, 578), num(208, C.kTop, 578), num(586, C.grand, 578),
    ]);
    expect(g.ok).toBe(true);
    expect(g.rows.get("94010050")).toMatchObject({ units_total: 586, erkek_denim_units: 150, kadin_denim_units: 88, cocuk_denim_units: 0, sweatshirt_units: 0, cocuk_units: 0 });
  });

  it("reyon toplamı kalemlerini tutmayan satırın denim adedi yazılmaz", () => {
    const g = parseBiCategoryGrid([
      ...header(true),
      label("94000044 - Ayşe Örnek", 578),
      num(110, C.eAks, 578), num(198, C.eDen, 578), num(999, C.eTop, 578), num(999, C.grand, 578),
    ]);
    expect(g.ok).toBe(false);
    expect(Number.isNaN(g.rows.get("94000044")!.erkek_denim_units)).toBe(true);
    expect(g.rows.get("94000044")!.units_total).toBe(999);
  });

  it("başlık satırı bulunamazsa boş döner (okuyucu metin yoluna düşer)", () => {
    expect(parseBiCategoryGrid([label("94000044 - Ayşe Örnek", 578), num(5, C.eDen, 578)]).rows.size).toBe(0);
  });
});

const NONE = { net_tl: null, upt: null, sepet: null, two_plus_one_pct: null, single_pct: null, transactions: null, denim_units: null, units_total: null, erkek_denim_units: null, kadin_denim_units: null };
const salesPage: BiPdfParsed = {
  kind: "bi_pdf", store_code: "9400", category_layout_ok: true, has_sales: true, has_category: false, month: 9, year: 2026,
  persons: [{ code: "94000027", name: "Bora Deneme", ...NONE, net_tl: 1417624, upt: 2.59, single_pct: 0.363, transactions: 614, denim_units: 281 }],
  total: { ...NONE, net_tl: 5691599, denim_units: 1243 },
};
const categoryPage: BiPdfParsed = {
  kind: "bi_pdf", store_code: "9400", category_layout_ok: true, has_sales: false, has_category: true, month: 9, year: 2026,
  persons: [
    { code: "94000027", name: "Bora Deneme", ...NONE, units_total: 1591, erkek_denim_units: 168, kadin_denim_units: 107, cocuk_denim_units: 6 },
    { code: "94000043", name: "Can Kemal Sınama", ...NONE, units_total: 34, erkek_denim_units: 0, kadin_denim_units: 0, cocuk_denim_units: 0 },
  ],
  total: { ...NONE, units_total: 6094, erkek_denim_units: 726, kadin_denim_units: 487, cocuk_denim_units: 30 },
};

describe("BI raporu iki ayrı PDF olarak gelirse", () => {
  it("ikinci dosya birincinin üstüne yazmaz, eksik sayfasını tamamlar — sıra fark etmez", () => {
    for (const m of [mergeBiPdf(salesPage, categoryPage), mergeBiPdf(categoryPage, salesPage)]) {
      expect(biPdfPagesOf(m)).toEqual({ sales: true, category: true });
      const bora = m.persons.find((p) => p.code === "94000027")!;
      expect(bora).toMatchObject({ net_tl: 1417624, denim_units: 281, units_total: 1591, erkek_denim_units: 168, kadin_denim_units: 107, cocuk_denim_units: 6 });
      // yalnız kategori sayfasında görünen kişi de korunur
      expect(m.persons.find((p) => p.code === "94000043")).toMatchObject({ net_tl: null, units_total: 34 });
      expect(m.total).toMatchObject({ net_tl: 5691599, denim_units: 1243, units_total: 6094, cocuk_denim_units: 30 });
    }
  });

  it("aynı sayfa yeniden yüklenirse yenisi geçerli olur, diğer sayfa korunur", () => {
    const both = mergeBiPdf(salesPage, categoryPage);
    const corrected: BiPdfParsed = { ...salesPage, persons: [{ ...salesPage.persons[0]!, net_tl: 1417999 }] };
    const m = mergeBiPdf(both, corrected);
    expect(m.persons.find((p) => p.code === "94000027")).toMatchObject({ net_tl: 1417999, units_total: 1591, cocuk_denim_units: 6 });
  });

  it("eski kayıtlarda sayfa bayrağı yoktur — içerikten anlaşılır", () => {
    const old: BiPdfParsed = { kind: "bi_pdf", store_code: "9401", category_layout_ok: true, persons: [{ code: "94010050", name: "Deniz Örnek", ...NONE, net_tl: 1227557, units_total: 1286 }], total: { ...NONE, net_tl: 4057009, units_total: 4370 } };
    expect(biPdfPagesOf(old)).toEqual({ sales: true, category: true });
  });
});
