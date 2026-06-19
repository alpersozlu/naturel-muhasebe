import "server-only";
import type { PrismaClient } from "@prisma/client";
import { categorizeMasraf } from "@/lib/masraf/categorize";

/**
 * FATURALI MASRAF DAĞITIM MOTORU (Faz 3a)
 *
 * Onaylanmış faturalı masraf dönemlerini alır, kategoride aylık toplar ve
 * mutabakat kurallarına göre Mavi mağazalarına dağıtır:
 *
 *  - Normal kategoriler (İŞÇİ, YEMEK, TERZİ, KIRTASİYE, MAZOT, SEYAHAT, DİĞER):
 *    aylık toplam ÷ (toplam mağaza sayısı = 7) → her mağazaya EŞİT pay.
 *  - MARKET: aylık toplam ÷7 → her mağaza payı → ½ TEMİZLİK + ½ YEMEK.
 *  - KİRA: 7'ye bölünmez — TAMAMI Güzelyurt'a (9403). Açıklamadan parse edilen
 *    "ait olduğu ay"a (belongs_month) yazılır; yoksa masraf ayına.
 *  - IGNORE (pazar): dağıtılmaz.
 *  - POS: burada değil (satışa dayalı, ayrı üretilir).
 *
 * Çıktı: matrix[kategori][ay 1-12][mağaza kodu 9400..9403] = TL.
 * Detay: docs/MASRAF-MUHASEBE-PLANI.md
 */

export const MAVI_STORE_CODES = ["9400", "9401", "9402", "9403"] as const;
export const MAVI_STORE_NAMES: Record<string, string> = {
  "9400": "Lefkoşa",
  "9401": "Girne",
  "9402": "Mağusa",
  "9403": "Güzelyurt",
};
const GUZELYURT = "9403";

export type StoreCell = Record<string, number>; // 9400..9403 → TL
export type FaturaliDagitim = {
  year: number;
  store_count: number; // ÷ böleni (kural: 7)
  /** kategori → ay(1-12) → mağaza kodu → tutar (TL) */
  matrix: Record<string, Record<number, StoreCell>>;
  /** dağıtılan toplam (kontrol) */
  total_distributed: number;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

export async function faturaliDagitim(
  prisma: PrismaClient,
  year: number
): Promise<FaturaliDagitim> {
  // ÷ böleni: toplam aktif mağaza (kural gereği 7; dinamik ki ileride değişirse uysun)
  const storeCount = (await prisma.store.count({ where: { deleted_at: null } })) || 7;

  const items = await prisma.invoicedExpenseItem.findMany({
    where: { batch: { status: "confirmed", period_year: year } },
    select: {
      category: true,
      amount_try: true,
      belongs_month: true,
      expense_date: true,
    },
  });

  // Ara toplamlar
  const normal: Record<string, Record<number, number>> = {}; // cat → ay → toplam
  const market: Record<number, number> = {}; // ay → market toplam
  const kira: Record<number, number> = {}; // ay → kira toplam (Güzelyurt)

  for (const it of items) {
    const amt = num(it.amount_try);
    if (amt === 0) continue;
    const monthFromDate = it.expense_date.getUTCMonth() + 1;
    if (it.category === "IGNORE") continue;
    if (it.category === "KIRA") {
      const m = it.belongs_month ?? monthFromDate;
      kira[m] = (kira[m] ?? 0) + amt;
      continue;
    }
    if (it.category === "MARKET") {
      market[monthFromDate] = (market[monthFromDate] ?? 0) + amt;
      continue;
    }
    (normal[it.category] ??= {})[monthFromDate] =
      (normal[it.category]?.[monthFromDate] ?? 0) + amt;
  }

  // Matris kur
  const matrix: Record<string, Record<number, StoreCell>> = {};
  let totalDistributed = 0;
  const add = (cat: string, month: number, code: string, val: number) => {
    if (val === 0) return;
    ((matrix[cat] ??= {})[month] ??= {})[code] =
      (matrix[cat]?.[month]?.[code] ?? 0) + val;
    totalDistributed += val;
  };

  // Normal kategoriler — aylık ÷7, her Mavi mağazaya eşit pay
  for (const [cat, byMonth] of Object.entries(normal)) {
    for (const [monthStr, total] of Object.entries(byMonth)) {
      const month = Number(monthStr);
      const per = total / storeCount;
      for (const code of MAVI_STORE_CODES) add(cat, month, code, per);
    }
  }

  // Market — ÷7 her mağaza payı → ½ TEMİZLİK + ½ YEMEK
  for (const [monthStr, total] of Object.entries(market)) {
    const month = Number(monthStr);
    const per = total / storeCount;
    const half = per / 2;
    for (const code of MAVI_STORE_CODES) {
      add("TEMIZLIK", month, code, half);
      add("YEMEK", month, code, half);
    }
  }

  // Kira — tamamı Güzelyurt'a (bölünmez)
  for (const [monthStr, total] of Object.entries(kira)) {
    add("KIRA", Number(monthStr), GUZELYURT, total);
  }

  return {
    year,
    store_count: storeCount,
    matrix,
    total_distributed: Math.round(totalDistributed * 100) / 100,
  };
}

// POS gideri oranı (Mavi'ye gösterim — sabit %5; gerçek komisyon Gider Analizi'nde)
const POS_RATE = 0.05;

/** Mağaza adından Mavi kodu (9400-9403); Mavi değilse null. */
export function maviCodeFromName(name: string): string | null {
  const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("lefko")) return "9400";
  if (n.includes("girne")) return "9401";
  if (n.includes("magusa") || n.includes("mağusa")) return "9402";
  if (n.includes("guzelyurt") || n.includes("güzelyurt")) return "9403";
  return null;
}

export type MatrixCell = {
  total: number;
  invoiced: number; // faturalı ÷7 dağıtım payı
  cash: number; // mağazanın kendi kasa masrafı
  pos: number; // POS %5
};
export type MasrafMatrix = {
  year: number;
  store_count: number;
  /** kategori → ay(1-12) → mağaza kodu → hücre (kaynak ayrımıyla) */
  matrix: Record<string, Record<number, Record<string, MatrixCell>>>;
};

/**
 * BİRLEŞİK MASRAF MATRİSİ (Faz 3b+3c) — Mavi.
 * Faturalı ÷7 dağıtım + her mağazanın kasa masrafı (açıklamadan kategorize) +
 * POS %5. Kaynak ayrımı (invoiced/cash/pos) korunur — "neyi ekledim" şeffaflığı.
 */
export async function masrafMatrix(
  prisma: PrismaClient,
  year: number
): Promise<MasrafMatrix> {
  const fatura = await faturaliDagitim(prisma, year);

  const matrix: Record<string, Record<number, Record<string, MatrixCell>>> = {};
  const cell = (cat: string, month: number, code: string): MatrixCell => {
    const c = (((matrix[cat] ??= {})[month] ??= {})[code] ??= {
      total: 0,
      invoiced: 0,
      cash: 0,
      pos: 0,
    });
    return c;
  };

  // 1) Faturalı dağıtım
  for (const [cat, byMonth] of Object.entries(fatura.matrix)) {
    for (const [m, byStore] of Object.entries(byMonth)) {
      for (const [code, val] of Object.entries(byStore)) {
        const c = cell(cat, Number(m), code);
        c.invoiced += val;
        c.total += val;
      }
    }
  }

  // Yıl aralığı
  const yStart = new Date(Date.UTC(year, 0, 1));
  const yEnd = new Date(Date.UTC(year + 1, 0, 1));

  // 2) Kasa masrafı — Mavi mağazaların Expense + CashAdvance (bonus/avans hariç).
  //    Açıklamadan kategorize, mağazanın KENDİSİNE (dağıtım yok). Market ½/½.
  const addCash = (
    code: string,
    month: number,
    rawCategory: string,
    desc: string | null,
    amt: number
  ) => {
    if (amt === 0) return;
    const cat = categorizeMasraf(desc ?? "").category;
    if (cat === "IGNORE") return;
    if (cat === "MARKET") {
      const half = amt / 2;
      cell("TEMIZLIK", month, code).cash += half;
      cell("TEMIZLIK", month, code).total += half;
      cell("YEMEK", month, code).cash += half;
      cell("YEMEK", month, code).total += half;
      return;
    }
    const c = cell(cat, month, code);
    c.cash += amt;
    c.total += amt;
  };

  const expenses = await prisma.expense.findMany({
    where: { expense_date: { gte: yStart, lt: yEnd } },
    select: {
      amount_try: true,
      description: true,
      category: true,
      expense_date: true,
      daily_record: { select: { store: { select: { name: true } } } },
    },
  });
  for (const e of expenses) {
    const code = maviCodeFromName(e.daily_record.store.name);
    if (!code) continue; // sadece Mavi
    addCash(code, e.expense_date.getUTCMonth() + 1, e.category, e.description, num(e.amount_try));
  }

  const advances = await prisma.cashAdvance.findMany({
    where: {
      category: { not: "bonus" }, // avans (bonus) ayrı takip — masraf değil
      daily_record: { date: { gte: yStart, lt: yEnd } },
    },
    select: {
      amount_try: true,
      description: true,
      category: true,
      daily_record: { select: { date: true, store: { select: { name: true } } } },
    },
  });
  for (const a of advances) {
    const code = maviCodeFromName(a.daily_record.store.name);
    if (!code) continue;
    addCash(code, a.daily_record.date.getUTCMonth() + 1, a.category, a.description, num(a.amount_try));
  }

  // 3) POS %5 — her Mavi mağazanın aylık satışı (kilitli günler) × %5
  const summaries = await prisma.storeSummary.findMany({
    where: {
      daily_record: { date: { gte: yStart, lt: yEnd }, status: "locked" },
    },
    select: {
      sales_total_try: true,
      daily_record: { select: { date: true, store: { select: { name: true } } } },
    },
  });
  for (const s of summaries) {
    const code = maviCodeFromName(s.daily_record.store.name);
    if (!code) continue;
    const sales = num(s.sales_total_try);
    if (sales <= 0) continue;
    const month = s.daily_record.date.getUTCMonth() + 1;
    const posCost = Math.round(sales * POS_RATE * 100) / 100;
    const c = cell("POS", month, code);
    c.pos += posCost;
    c.total += posCost;
  }

  return { year, store_count: fatura.store_count, matrix };
}
