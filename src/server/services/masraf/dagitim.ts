import "server-only";
import type { PrismaClient } from "@prisma/client";
import { categorizeExpense, categorizeMasraf, type MasrafKategori } from "@/lib/masraf/categorize";
import { getMasrafBrand, brandCodeFromName, rowKeyOf, type MasrafBrand } from "@/lib/masraf/brands";
import { computeFromLine, lineInclude } from "@/server/services/payroll/period";

/**
 * MASRAF DAĞITIM MOTORU (Faz 3 → Faz 7, 19.10.2026)
 *
 * Kaynaklar ve kurallar (sahibi):
 *  - ŞİRKET FATURALARI: kart Excel'i (InvoicedExpenseItem, onaylı dönem) + sahibinin
 *    fatura fotoğrafları (MasrafInvoice, classification=company). Kategoride aylık
 *    toplanır → ÷7 (toplam şirket mağazası) → markanın her mağazasına EŞİT pay.
 *    MARKET: ÷7 → her mağaza payı ½ TEMİZLİK + ½ YEMEK. KİRA: 7'ye bölünmez, markanın
 *    kira mağazasına (Mavi: Güzelyurt). IGNORE (pazar/avans): dağıtılmaz.
 *  - KASA: mağazanın kendi masraf fişleri (Expense) + faturasız peşin ödemeleri
 *    (CashAdvance, avans hariç). Kategori: yönetici düzeltmesi (masraf_category) ya da
 *    kategori+satıcı+açıklamadan otomatik. MARKET ½/½. İŞÇİ → ÇALIŞMA ÜCRETİ satırı.
 *  - POS GİDERİ: kilitli günlerin Visa (kredi kartı) toplamı × %5.
 *  - DEFOLU: İndirim Kontrol push.
 *  - BORDRO: Çalışma Ücreti = baz maaş + ek hak ediş; Prim = komisyon + primler;
 *    Mesai = ek mesai ücreti (Maaşlar modülü, mağaza mağaza).
 *  - ELLE: MasrafManualEntry (SSK, yol, elektrik ana fatura, ofis…).
 *
 * Çıktı: matrix[SATIR][ay 1-12][mağaza kodu] = hücre (kaynak ayrımlı).
 * Satır düzeni: src/lib/masraf/brands.ts · sözlük: docs/MASRAF-MUHASEBE-PLANI.md
 */

export type StoreCell = Record<string, number>; // mağaza kodu → TL
export type FaturaliDagitim = {
  year: number;
  store_count: number; // ÷ böleni (toplam şirket mağazası, kural: 7)
  /** satır → ay(1-12) → mağaza kodu → tutar (TL) */
  matrix: Record<string, Record<number, StoreCell>>;
  /** dağıtılan toplam (kontrol) */
  total_distributed: number;
  /** kaynak sayıları (şeffaflık) */
  excel_items: number;
  photo_items: number;
};

function num(v: { toNumber: () => number } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function companyStoreCount(prisma: PrismaClient): Promise<number> {
  return (await prisma.store.count({ where: { deleted_at: null } })) || 7;
}

export async function faturaliDagitim(prisma: PrismaClient, year: number, brandKey = "mavi"): Promise<FaturaliDagitim> {
  const brand = getMasrafBrand(brandKey);
  const codes = brand.stores.map((s) => s.code);
  const storeCount = await companyStoreCount(prisma);

  const [excelItems, photoItems] = await Promise.all([
    prisma.invoicedExpenseItem.findMany({
      where: { batch: { status: "confirmed", period_year: year } },
      select: { category: true, amount_try: true, belongs_month: true, expense_date: true },
    }),
    prisma.masrafInvoice.findMany({
      where: { period_year: year, classification: "company", ocr_status: "done", deleted_at: null, amount_try: { not: null }, category: { not: null } },
      select: { category: true, amount_try: true, belongs_month: true, period_month: true },
    }),
  ]);

  type Item = { category: string; amount: number; month: number; belongs_month: number | null };
  const items: Item[] = [
    ...excelItems.map((it) => ({ category: it.category, amount: num(it.amount_try), month: it.expense_date.getUTCMonth() + 1, belongs_month: it.belongs_month })),
    ...photoItems.map((it) => ({ category: it.category!, amount: num(it.amount_try), month: it.period_month, belongs_month: it.belongs_month })),
  ];

  // Ara toplamlar
  const normal: Record<string, Record<number, number>> = {}; // cat → ay → toplam
  const market: Record<number, number> = {};
  const kira: Record<number, number> = {};

  for (const it of items) {
    if (it.amount === 0 || it.category === "IGNORE") continue;
    if (it.category === "KIRA") {
      const m = it.belongs_month ?? it.month;
      kira[m] = (kira[m] ?? 0) + it.amount;
      continue;
    }
    if (it.category === "MARKET") {
      market[it.month] = (market[it.month] ?? 0) + it.amount;
      continue;
    }
    (normal[it.category] ??= {})[it.month] = (normal[it.category]?.[it.month] ?? 0) + it.amount;
  }

  const matrix: Record<string, Record<number, StoreCell>> = {};
  let totalDistributed = 0;
  const add = (cat: string, month: number, code: string, val: number) => {
    if (val === 0) return;
    const row = rowKeyOf(cat);
    ((matrix[row] ??= {})[month] ??= {})[code] = (matrix[row]?.[month]?.[code] ?? 0) + val;
    totalDistributed += val;
  };

  for (const [cat, byMonth] of Object.entries(normal)) {
    for (const [monthStr, total] of Object.entries(byMonth)) {
      const per = total / storeCount;
      for (const code of codes) add(cat, Number(monthStr), code, per);
    }
  }
  for (const [monthStr, total] of Object.entries(market)) {
    const half = total / storeCount / 2;
    for (const code of codes) {
      add("TEMIZLIK", Number(monthStr), code, half);
      add("YEMEK", Number(monthStr), code, half);
    }
  }
  if (brand.kiraStoreCode) {
    for (const [monthStr, total] of Object.entries(kira)) add("KIRA", Number(monthStr), brand.kiraStoreCode, total);
  }

  return { year, store_count: storeCount, matrix, total_distributed: r2(totalDistributed), excel_items: excelItems.length, photo_items: photoItems.length };
}

// POS gideri oranı — sahibi: aylık Visa toplamının %5'i (gerçek komisyon Gider Analizi'nde)
export const POS_RATE = 0.05;

/** Mağaza adından Mavi kodu (9400-9403); Mavi değilse null. (Geriye dönük uyum.) */
export function maviCodeFromName(name: string): string | null {
  return brandCodeFromName(getMasrafBrand("mavi"), name);
}

export type MasrafSource = "invoiced" | "cash" | "pos" | "defolu" | "payroll" | "manual";
export const MASRAF_SOURCES: MasrafSource[] = ["invoiced", "cash", "pos", "defolu", "payroll", "manual"];

export type MatrixCell = {
  total: number;
  invoiced: number; // şirket faturası ÷7 payı (Excel + fotoğraf)
  cash: number; // mağazanın kendi kasa masrafı
  pos: number; // POS %5
  defolu: number; // İndirim Kontrol push
  payroll: number; // Maaşlar modülü (çalışma ücreti / prim / mesai)
  manual: number; // elle girilen hücre
};
export type MasrafMatrix = {
  year: number;
  brand: string;
  store_count: number;
  /** satır → ay(1-12) → mağaza kodu → hücre (kaynak ayrımıyla) */
  matrix: Record<string, Record<number, Record<string, MatrixCell>>>;
  /** bordro verisi bulunan aylar */
  payroll_months: number[];
};

/** Markanın mağazalarının DB id → çıktı kodu eşlemesi (brand-scoped; sızıntı yok). */
export async function buildStoreCodeMap(prisma: PrismaClient, brand: MasrafBrand): Promise<Map<string, string>> {
  const stores = await prisma.store.findMany({
    where: { brand: { name: brand.brandName }, deleted_at: null },
    select: { id: true, name: true, city: true },
  });
  const map = new Map<string, string>();
  for (const s of stores) {
    const code = brandCodeFromName(brand, `${s.name} ${s.city ?? ""}`);
    if (code) map.set(s.id, code);
  }
  return map;
}

/**
 * Kasa kaleminin masraf kategorisi: yönetici düzeltmesi varsa o; yoksa
 * kategori + satıcı + açıklamadan otomatik (categorize.ts).
 */
export function resolveCashCategory(item: {
  masraf_category?: string | null;
  category: string;
  vendor?: string | null;
  description?: string | null;
}): { category: MasrafKategori; auto: MasrafKategori; overridden: boolean; needsReview: boolean } {
  const auto = categorizeExpense({ category: item.category, vendor: item.vendor, description: item.description });
  if (item.masraf_category) return { category: item.masraf_category as MasrafKategori, auto: auto.category, overridden: true, needsReview: false };
  return { category: auto.category, auto: auto.category, overridden: false, needsReview: auto.needsReview };
}

/** Kart Excel satırı için eski metin kuralı (geriye dönük). */
export { categorizeMasraf };

/**
 * BİRLEŞİK MASRAF MATRİSİ — tüm kaynaklar, kaynak ayrımı korunur (şeffaflık).
 * Mağaza eşleştirmesi brand_id ile sınırlı (markalar arası sızıntı yok).
 */
export async function masrafMatrix(prisma: PrismaClient, year: number, brandKey = "mavi"): Promise<MasrafMatrix> {
  const brand = getMasrafBrand(brandKey);
  const fatura = await faturaliDagitim(prisma, year, brandKey);
  const idToCode = await buildStoreCodeMap(prisma, brand);

  const matrix: Record<string, Record<number, Record<string, MatrixCell>>> = {};
  const cell = (row: string, month: number, code: string): MatrixCell =>
    (((matrix[row] ??= {})[month] ??= {})[code] ??= { total: 0, invoiced: 0, cash: 0, pos: 0, defolu: 0, payroll: 0, manual: 0 });
  const put = (row: string, month: number, code: string, source: MasrafSource, val: number) => {
    if (!val) return;
    const c = cell(row, month, code);
    c[source] += val;
    c.total += val;
  };

  // 1) Şirket faturaları (÷7 dağıtım; satır anahtarına çevrilmiş geliyor)
  for (const [row, byMonth] of Object.entries(fatura.matrix)) {
    for (const [m, byStore] of Object.entries(byMonth)) {
      for (const [code, val] of Object.entries(byStore)) put(row, Number(m), code, "invoiced", val);
    }
  }

  const yStart = new Date(Date.UTC(year, 0, 1));
  const yEnd = new Date(Date.UTC(year + 1, 0, 1));

  // 2) Kasa masrafı — mağazanın KENDİSİNE (dağıtım yok). Market ½/½. İşçi → Çalışma Ücreti.
  const addCash = (code: string, month: number, cat: MasrafKategori, amt: number) => {
    if (amt === 0 || cat === "IGNORE") return;
    if (cat === "MARKET") {
      put("TEMIZLIK", month, code, "cash", amt / 2);
      put("YEMEK", month, code, "cash", amt / 2);
      return;
    }
    put(rowKeyOf(cat), month, code, "cash", amt);
  };

  const expenses = await prisma.expense.findMany({
    where: { expense_date: { gte: yStart, lt: yEnd }, daily_record: { store: { brand: { name: brand.brandName } } } },
    select: { amount_try: true, category: true, vendor: true, description: true, masraf_category: true, expense_date: true, daily_record: { select: { store_id: true } } },
  });
  for (const e of expenses) {
    const code = idToCode.get(e.daily_record.store_id);
    if (!code) continue;
    addCash(code, e.expense_date.getUTCMonth() + 1, resolveCashCategory(e).category, num(e.amount_try));
  }

  const advances = await prisma.cashAdvance.findMany({
    where: { category: { not: "bonus" }, daily_record: { date: { gte: yStart, lt: yEnd }, store: { brand: { name: brand.brandName } } } },
    select: { amount_try: true, category: true, description: true, masraf_category: true, daily_record: { select: { date: true, store_id: true } } },
  });
  for (const a of advances) {
    const code = idToCode.get(a.daily_record.store_id);
    if (!code) continue;
    addCash(code, a.daily_record.date.getUTCMonth() + 1, resolveCashCategory({ ...a, vendor: null }).category, num(a.amount_try));
  }

  // 3) POS %5 — kilitli günlerin Visa (kredi kartı) toplamı × %5
  const summaries = await prisma.storeSummary.findMany({
    where: { daily_record: { date: { gte: yStart, lt: yEnd }, status: "locked", store: { brand: { name: brand.brandName } } } },
    select: { credit_card_total_try: true, daily_record: { select: { date: true, store_id: true } } },
  });
  const visaByCell = new Map<string, number>();
  for (const s of summaries) {
    const code = idToCode.get(s.daily_record.store_id);
    if (!code) continue;
    const visa = num(s.credit_card_total_try);
    if (visa <= 0) continue;
    const k = `${s.daily_record.date.getUTCMonth() + 1}|${code}`;
    visaByCell.set(k, (visaByCell.get(k) ?? 0) + visa);
  }
  for (const [k, visa] of Array.from(visaByCell.entries())) {
    const [m, code] = k.split("|");
    put("POS", Number(m), code!, "pos", r2(visa * POS_RATE));
  }

  // 4) DEFOLU — İndirim Kontrol push
  const brandCodes = brand.stores.map((s) => s.code);
  const defoluRows = await prisma.defoluEntry.findMany({
    where: { period_year: year, store_code: { in: brandCodes } },
    select: { period_month: true, store_code: true, amount_try: true },
  });
  for (const d of defoluRows) put("DEFOLU", d.period_month, d.store_code, "defolu", num(d.amount_try));

  // 5) BORDRO — Maaşlar modülü: çalışma ücreti / prim / mesai, mağaza mağaza.
  //    Tek sorgu (yılın tüm satırları); loadPeriodView dönem başına ~3 s sürüyordu.
  const [periods, lines] = await Promise.all([
    prisma.payrollPeriod.findMany({ where: { year }, select: { id: true, month: true, store_months: { select: { store_id: true, revenue: true, target: true } } } }),
    prisma.payrollLine.findMany({ where: { period: { year } }, include: lineInclude }),
  ]);
  const monthOf = new Map(periods.map((p) => [p.id, p.month]));
  const storeMonth = new Map<string, { revenue: number | null; target: number | null }>();
  for (const p of periods) for (const sm of p.store_months) storeMonth.set(`${p.id}|${sm.store_id}`, { revenue: sm.revenue == null ? null : Number(sm.revenue), target: sm.target == null ? null : Number(sm.target) });
  const payrollMonths = new Set<number>();
  const agg = new Map<string, { base: number; prim: number; mesai: number; tazminat: number }>();
  for (const l of lines) {
    const code = idToCode.get(l.store_id);
    const month = monthOf.get(l.period_id);
    if (!code || !month || l.employee.status === "inactive") continue;
    const c = computeFromLine(l, storeMonth.get(`${l.period_id}|${l.store_id}`) ?? { revenue: null, target: null });
    const k = `${month}|${code}`;
    const a = agg.get(k) ?? { base: 0, prim: 0, mesai: 0, tazminat: 0 };
    // ek hak edişler: izin/çıkış ödemesi → TAZMİNAT, bonus → PRİM, diğer → ÇALIŞMA ÜCRETİ
    // (devir çifti "carry_forward" hak ediş değildir, sayılmaz)
    for (const e of c.calc.entries) {
      if (e.kind !== "addition" || !e.counted || e.category === "carry_forward") continue;
      if (e.category === "leave_payout") a.tazminat += e.amount;
      else if (e.category === "bonus") a.prim += e.amount;
      else a.base += e.amount;
    }
    a.base += c.base_salary;
    a.prim += c.calc.commission.final + c.calc.perfume_amount + c.calc.garment_amount + c.calc.top_seller_amount + c.calc.extra_premium;
    a.mesai += c.calc.overtime_amount;
    agg.set(k, a);
    if (a.base || a.prim || a.mesai) payrollMonths.add(month);
  }
  for (const [k, a] of Array.from(agg.entries())) {
    const [m, code] = k.split("|");
    put("CALISMA_UCRETI", Number(m), code!, "payroll", r2(a.base));
    put("PRIM", Number(m), code!, "payroll", r2(a.prim));
    put("MESAI", Number(m), code!, "payroll", r2(a.mesai));
    put("TAZMINAT", Number(m), code!, "payroll", r2(a.tazminat));
  }

  // 6) ELLE girilen hücreler
  const manual = await prisma.masrafManualEntry.findMany({ where: { brand: brandKey, period_year: year } });
  for (const m of manual) put(m.row_key, m.period_month, m.store_code, "manual", num(m.amount_try));

  return { year, brand: brandKey, store_count: fatura.store_count, matrix, payroll_months: Array.from(payrollMonths).sort((a, b) => a - b) };
}
