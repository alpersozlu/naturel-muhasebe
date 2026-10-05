import { describe, expect, it } from "vitest";
import { buildPerformanceCheck, UNCODED_LABEL, type BiPdfParsed, type ItPosRepsParsed, type KpiParsed, type PerfLineRef } from "@/server/services/payroll/performance";
import type { DailyRepMonth } from "@/server/services/dealer-report/daily-reps";

const NONE = { upt: null, sepet: null, two_plus_one_pct: null, single_pct: null, transactions: null, denim_units: null, units_total: null, erkek_denim_units: null, kadin_denim_units: null };
const bi = (persons: Array<[string, string, number]>): BiPdfParsed => ({
  kind: "bi_pdf",
  store_code: "9401",
  persons: persons.map(([code, name, net_tl]) => ({ code, name, net_tl, ...NONE })),
  total: { net_tl: persons.reduce((s, p) => s + p[2], 0), ...NONE },
  category_layout_ok: true,
});
const kpi = (persons: Array<[string, string, number]>): KpiParsed => ({
  kind: "kpi_xlsx",
  store_code: "9401",
  store_label: "Girne (9401)",
  persons: persons.map(([code, name, denim]) => ({ code, name, denim_tl_erkek: denim, denim_tl_kadin: 0, denim_units_erkek: 0, denim_units_kadin: 0, category_tl_total: denim, units_total: 0 })),
});
const line = (id: string, full_name: string, profile = "mavi_asistan"): PerfLineRef => ({
  line_id: id, employee_id: `e-${id}`, full_name, aliases: [], bank_account_name: null, commission_profile: profile, own_revenue_nd: null, own_revenue_denim: null, top_seller: false,
});
const itpos = (persons: Array<[string, number]>): ItPosRepsParsed => ({ kind: "itpos_reps", persons: persons.map(([name, net_ciro]) => ({ name, net_ciro, units: null, invoices: null })) });
/** [kod, ad, net ciro, denim tahmini?, IT POS'un düşmediği Kartuş payı? (verilmezse 0; null = bilinmiyor)] */
const daily = (persons: Array<[string, string, number, (number | null)?, (number | null)?]>, over: Partial<DailyRepMonth> = {}): DailyRepMonth => ({
  days_expected: 30, days_present: 30, days_missing: [], month_over: true, complete: true, upload_days: 30, archive_days: 0, not_original_days: [],
  store_net: Math.round(persons.reduce((s, p) => s + p[2], 0) * 100) / 100,
  persons: persons.map(([code, name, net_ciro, denim_est, itpos_extra]) => ({
    code,
    name,
    net_ciro,
    kartus: 0,
    units: 0,
    days: 30,
    denim_est: denim_est ?? null,
    denim_units_est: null,
    itpos_extra: itpos_extra === undefined ? 0 : itpos_extra,
  })),
  ...over,
});
const LINES = [line("1", "Maral Rahmanova"), line("2", "Enes Demir")];
const hasError = (c: ReturnType<typeof buildPerformanceCheck>) => c.flags.some((f) => f.level === "error") || c.rows.some((r) => r.flags.some((f) => f.level === "error"));

describe("performans çapraz kontrolü — günlük bayi dosyaları", () => {
  it("günlük dosyalar BI ile aynı liradaysa kuruşlu günlük rakam kullanılır", () => {
    const c = buildPerformanceCheck(
      [bi([["94010020", "Maral Rahmanova", 1038234], ["94010049", "Enes Demir", 806726]]), kpi([["94010020", "Maral Rahmanova", 400000], ["94010049", "Enes Demir", 300000]])],
      LINES,
      daily([["94010020", "Maral Rahmanova", 1038234.31], ["94010049", "Enes Demir", 806726.21]])
    );
    expect(hasError(c)).toBe(false);
    expect(c.ready).toBe(true);
    expect(c.daily_agrees).toBe(true);
    const maral = c.rows.find((r) => r.code === "94010020")!;
    expect(maral.net_used).toBe(1038234.31);
    expect(maral.net_used_source).toBe("daily");
    expect(maral.nd_tl).toBe(638234.31);
  });

  it("günler tamken ay sonu belgesi 250 ₺'den fazla yüksekse aktarım durur", () => {
    const c = buildPerformanceCheck(
      [bi([["94010020", "Maral Rahmanova", 1068234], ["94010049", "Enes Demir", 806726]]), kpi([["94010020", "Maral Rahmanova", 400000]])],
      LINES,
      daily([["94010020", "Maral Rahmanova", 1038234.31], ["94010049", "Enes Demir", 806726.21]])
    );
    expect(hasError(c)).toBe(true);
    expect(c.ready).toBe(false);
    expect(c.daily_agrees).toBe(false);
    const maral = c.rows.find((r) => r.code === "94010020")!;
    expect(maral.net_used_source).toBe("bi");
    expect(maral.flags.some((f) => f.level === "error" && f.text.startsWith("Günlük dosyalar"))).toBe(true);
  });

  it("mağaza toplamı aynı kalıp ciro bir kişiden diğerine kaydırılmışsa yakalanır", () => {
    const c = buildPerformanceCheck(
      [bi([["94010020", "Maral Rahmanova", 1100000], ["94010049", "Enes Demir", 700000]]), kpi([["94010020", "Maral Rahmanova", 400000]])],
      LINES,
      daily([["94010020", "Maral Rahmanova", 1000000], ["94010049", "Enes Demir", 800000]])
    );
    expect(hasError(c)).toBe(true);
    expect(c.daily_agrees).toBe(false);
  });

  it("günler eksikse fark hata sayılmaz, yalnız eksik gün uyarısı verilir", () => {
    const c = buildPerformanceCheck(
      [bi([["94010020", "Maral Rahmanova", 1038234], ["94010049", "Enes Demir", 806726]]), kpi([["94010020", "Maral Rahmanova", 400000]])],
      LINES,
      daily([["94010020", "Maral Rahmanova", 900000], ["94010049", "Enes Demir", 700000]], { days_present: 26, days_missing: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"], complete: false })
    );
    expect(hasError(c)).toBe(false);
    expect(c.flags.some((f) => f.level === "warn" && f.text.includes("eksik: 4 gün"))).toBe(true);
    expect(c.rows.find((r) => r.code === "94010020")!.net_used).toBe(1038234);
    expect(c.ready).toBe(true);
  });

  it("ay sonu belgesi olmadan, günler tamsa ciro günlük dosyalardan alınır", () => {
    const c = buildPerformanceCheck([], LINES, daily([["94010020", "Maral Rahmanova", 1038234.31], ["94010049", "Enes Demir", 806726.21]]));
    expect(c.store_net).toBe(1844960.52);
    expect(c.store_net_source).toBe("daily");
    expect(c.top_seller).toBe("Maral Rahmanova");
    expect(c.ready).toBe(false); // KPI yok → denim ayrımı yapılamaz
    expect(hasError(c)).toBe(false);
  });

  it("KPI'daki denim tutarı günlük tahminden çok saparsa uyarır, küçük sapmada susar — aktarımı durdurmaz", () => {
    const docs = (denim: number) => [bi([["94010020", "Maral Rahmanova", 1038234], ["94010049", "Enes Demir", 806726]]), kpi([["94010020", "Maral Rahmanova", denim]])];
    const d = daily([["94010020", "Maral Rahmanova", 1038234.31, 349318.67], ["94010049", "Enes Demir", 806726.21, 233025.84]]);
    const near = buildPerformanceCheck(docs(344317.35), LINES, d); // gerçek Eylül 2026: tahmin %1,5 yüksek
    expect(near.rows.find((r) => r.code === "94010020")!.flags.some((f) => f.text.startsWith("Denim tutarı"))).toBe(false);
    expect(near.rows.find((r) => r.code === "94010020")!.denim_daily_est).toBe(349318.67);
    const far = buildPerformanceCheck(docs(444317.35), LINES, d); // 100.000 ₺ şişirilmiş
    const flag = far.rows.find((r) => r.code === "94010020")!.flags.find((f) => f.text.startsWith("Denim tutarı"));
    expect(flag?.level).toBe("warn");
    expect(hasError(far)).toBe(false);
    expect(far.ready).toBe(true);
  });

  it("temsilci kodu girilmemiş satış kimsenin cirosuna eklenmez; kısa ad bordrodaki uzun adla eşleşir", () => {
    // Lefkoşa Eylül 2026: günlük dosyada kod "—", ad "Sonuc Baloglu", 1.724,13 — SAP kişi tablosu bunu müdüre yazmıyor.
    const c = buildPerformanceCheck(
      [],
      [line("9", "Muhammet Fırat Öner"), line("8", "Sonuç Baloğlu", "mavi_mudur")],
      daily([["94000036", "Fırat Öner", 880235.18], ["94000001", "Sonuc Baloglu", 66777.14], ["—", "Sonuc Baloglu", 1724.13]])
    );
    expect(c.rows).toHaveLength(3);
    expect(c.rows.find((r) => r.code === "94000036")!.line_id).toBe("9");
    const sonuc = c.rows.find((r) => r.code === "94000001")!;
    expect(sonuc.net_daily).toBe(66777.14);
    expect(sonuc.line_id).toBe("8");
    const uncoded = c.rows.find((r) => r.uncoded)!;
    expect(uncoded.name).toBe(UNCODED_LABEL);
    expect(uncoded.net_daily).toBe(1724.13);
    expect(uncoded.line_id).toBeNull();
    // mağaza cirosunda var: kişi toplamı mağaza toplamını tutar
    expect(c.persons_sum).toBe(c.store_net);
    expect(hasError(c)).toBe(false);
  });

  it("KPI raporundaki kodsuz ikinci satır da aynı satıra gider, müdürün rakamını ezmez", () => {
    const k = kpi([["94000001", "Sonuc Baloglu", 47526.09]]);
    k.persons.unshift({ code: null, name: "Sonuc Baloglu", denim_tl_erkek: 1724.13, denim_tl_kadin: 0, denim_units_erkek: 1, denim_units_kadin: 0, category_tl_total: 1724.13, units_total: 1 });
    const c = buildPerformanceCheck([k], [line("8", "Sonuç Baloğlu", "mavi_mudur")], daily([["94000001", "Sonuc Baloglu", 66777.14], ["—", "Sonuc Baloglu", 1724.13]]));
    expect(c.rows.find((r) => r.code === "94000001")!.denim_tl).toBe(47526.09);
    expect(c.rows.find((r) => r.uncoded)!.denim_tl).toBe(1724.13);
    expect(hasError(c)).toBe(false);
  });
});

/**
 * İKİ SAP RAKAMI. Ortak fişte (birden çok temsilci) Kartuş payını BI herkese
 * yazar; IT POS kişi tablosu yalnız ilk okutulan ürünün temsilcisinden düşer.
 * Günlük dosyalar her kişi için IT POS'un düşmediği payı da verir.
 * Gerçek rakamlar: Mavi Lefkoşa, Eylül 2026.
 */
describe("performans çapraz kontrolü — IT POS kişi tablosu ve ortak fişler", () => {
  const L = [line("1", "Batuhan Kuru"), line("2", "Yaşar Kemal Tıngır"), line("3", "Didem Aydoğan", "mavi_vice")];
  const D = () =>
    daily([
      ["94000044", "Batuhan Kuru", 1628099.98, null, 1961.32],
      ["94000038", "Yaşar Kemal Tıngır", 1672920.02, null, 1173.14],
      ["94000040", "Didem Aydoğan", 8404.31, null, 0],
    ]);
  const K = kpi([["94000044", "Batuhan Kuru", 558610.4], ["94000038", "Yaşar Kemal Tıngır", 635531.77], ["94000040", "Didem Aydoğan", 2603.45]]);

  it("IT POS, düşülmeyen Kartuş payı kadar yüksekse belge DOĞRUDUR; bordroya mağaza cirosuyla tutan rakam gider", () => {
    const c = buildPerformanceCheck([itpos([["Batuhan Kuru", 1630061.3], ["Yaşar Kemal Tıngır", 1674093.16], ["Didem Aydoğan", 8404.31]]), K], L, D());
    expect(hasError(c)).toBe(false);
    expect(c.ready).toBe(true);
    const batuhan = c.rows.find((r) => r.code === "94000044")!;
    expect(batuhan.itpos_extra).toBe(1961.32);
    expect(batuhan.net_used).toBe(1628099.98);
    expect(batuhan.net_used_source).toBe("daily");
    expect(batuhan.nd_tl).toBe(1069489.58);
    expect(batuhan.flags.some((f) => f.level === "info" && f.text.includes("1.961,32"))).toBe(true);
    expect(batuhan.flags.some((f) => f.level === "error")).toBe(false);
    expect(batuhan.flags.some((f) => f.text.startsWith("Günlük dosyalar"))).toBe(false);
    // ortak fişi olmayan kişide IT POS rakamı aynen kullanılır
    const didem = c.rows.find((r) => r.code === "94000040")!;
    expect(didem.net_used_source).toBe("itpos");
    expect(didem.net_used).toBe(8404.31);
    // kişiler toplamı mağaza cirosunu tutar (IT POS toplamı 3.134,46 fazla olurdu)
    expect(c.persons_sum).toBe(3309424.31);
    expect(c.persons_sum).toBe(c.store_net);
    expect(c.top_seller).toBe("Yaşar Kemal Tıngır");
  });

  it("KPI raporu IT POS tabanındadır: kategori toplamı pay oranlı ciroyu düşülmeyen pay kadar aşabilir", () => {
    // Lefkoşa kasiyeri, Eylül 2026: IT POS = KPI toplamı = 15.930,56 · pay oranlı 15.814,29 (fark 116,27)
    const k: KpiParsed = { kind: "kpi_xlsx", store_code: "9400", store_label: null, persons: [{ code: "94000043", name: "Meltem Demirbilek", denim_tl_erkek: 0, denim_tl_kadin: 0, denim_units_erkek: 0, denim_units_kadin: 0, category_tl_total: 15930.56, units_total: 34 }] };
    const lines = [line("7", "Meltem Demirbilek", "none")];
    const ok = buildPerformanceCheck([itpos([["Meltem Demirbilek", 15930.56]]), k], lines, daily([["94000043", "Meltem Demirbilek", 15814.29, null, 116.27]]));
    expect(hasError(ok)).toBe(false);
    expect(ok.rows[0]!.net_used).toBe(15814.29);
    // ama IT POS tabanını da aşıyorsa hata
    k.persons[0]!.category_tl_total = 16500;
    expect(hasError(buildPerformanceCheck([itpos([["Meltem Demirbilek", 15930.56]]), k], lines, daily([["94000043", "Meltem Demirbilek", 15814.29, null, 116.27]])))).toBe(true);
  });

  it("IT POS beklenenden de yüksekse (250 ₺ üstü) aktarım durur", () => {
    const c = buildPerformanceCheck([itpos([["Batuhan Kuru", 1632061.3], ["Yaşar Kemal Tıngır", 1674093.16], ["Didem Aydoğan", 8404.31]]), K], L, D());
    expect(hasError(c)).toBe(true);
    const batuhan = c.rows.find((r) => r.code === "94000044")!;
    expect(batuhan.net_used_source).toBe("itpos");
    const err = batuhan.flags.find((f) => f.level === "error")!;
    expect(err.text).toContain("IT POS'un düşmediği Kartuş payı 1.961,32");
    expect(err.text).toContain("belge +2.000,00");
  });

  it("düşülmeyen pay bilinmiyorsa (eski günlük kayıt) fark açıklanamaz: eskisi gibi hata", () => {
    const d = daily([["94000044", "Batuhan Kuru", 1628099.98, null, null], ["94000038", "Yaşar Kemal Tıngır", 1672920.02, null, 0], ["94000040", "Didem Aydoğan", 8404.31, null, 0]]);
    const c = buildPerformanceCheck([itpos([["Batuhan Kuru", 1630061.3], ["Yaşar Kemal Tıngır", 1672920.02], ["Didem Aydoğan", 8404.31]]), K], L, d);
    const batuhan = c.rows.find((r) => r.code === "94000044")!;
    expect(batuhan.itpos_extra).toBeNull();
    expect(batuhan.flags.some((f) => f.level === "error" && f.text.startsWith("Günlük dosyalar"))).toBe(true);
  });

  it("BI ile IT POS arasındaki fark düşülmeyen pay kadarsa iki kaynak çelişmez (Girne, Emre A.: 37,50)", () => {
    const lines = [line("1", "Emre Atılgan"), line("2", "Maral Rahmanova")];
    const c = buildPerformanceCheck(
      [
        bi([["94010050", "Emre Atılgan", 1227557], ["94010020", "Maral Rahmanova", 1038234]]),
        itpos([["Emre Atılgan", 1227594.53], ["Maral Rahmanova", 1038234.31]]),
        kpi([["94010050", "Emre Atılgan", 408710.57], ["94010020", "Maral Rahmanova", 344317.35]]),
      ],
      lines,
      daily([["94010050", "Emre Atılgan", 1227557.03, null, 37.5], ["94010020", "Maral Rahmanova", 1038234.31, null, 0]])
    );
    expect(hasError(c)).toBe(false);
    const emre = c.rows.find((r) => r.code === "94010050")!;
    expect(emre.flags.some((f) => f.text.startsWith("Kişi cirosu iki kaynakta farklı"))).toBe(false);
    expect(emre.net_used).toBe(1227557.03); // 03.10.2026'da bordroya alınan rakam
    expect(c.rows.find((r) => r.code === "94010020")!.net_used).toBe(1038234.31);
  });

  it("günlük dosya yokken IT POS, BI'dan yüksekse neden olabileceğini söyler", () => {
    const c = buildPerformanceCheck(
      [bi([["94010050", "Emre Atılgan", 1227557]]), itpos([["Emre Atılgan", 1227594.53]]), kpi([["94010050", "Emre Atılgan", 408710.57]])],
      [line("1", "Emre Atılgan")],
      null
    );
    const f = c.rows[0]!.flags.find((x) => x.text.startsWith("Kişi cirosu iki kaynakta farklı"))!;
    expect(f.level).toBe("warn");
    expect(f.text).toContain("ilk okutulan ürünün temsilcisinden");
  });
});
