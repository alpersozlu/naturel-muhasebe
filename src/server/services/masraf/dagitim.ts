import "server-only";
import type { PrismaClient } from "@prisma/client";
import { categorizeMasraf } from "@/lib/masraf/categorize";
import {
  getMasrafBrand,
  brandCodeFromName,
  type MasrafBrand,
} from "@/lib/masraf/brands";

/**
 * FATURALI MASRAF DAĞITIM MOTORU (Faz 3a, Faz 6'da brand-parametrik)
 *
 * Onaylanmış faturalı masraf dönemlerini alır, kategoride aylık toplar ve
 * mutabakat kurallarına göre SEÇİLEN MARKANIN mağazalarına dağıtır:
 *
 *  - Normal kategoriler (İŞÇİ, YEMEK, TERZİ, KIRTASİYE, MAZOT, SEYAHAT, DİĞER):
 *    aylık toplam ÷ (toplam ŞİRKET mağaza sayısı = 7) → markanın her mağazasına EŞİT pay.
 *    (Faturalı dosya iki markayı da kapsar; Mavi 4 payı, Derimod 3 payı = 3/7 alır.)
 *  - MARKET: aylık toplam ÷7 → her mağaza payı → ½ TEMİZLİK + ½ YEMEK.
 *  - KİRA: 7'ye bölünmez — TAMAMI markanın kira mağazasına (Mavi: Güzelyurt 9403).
 *    kiraStoreCode null ise (Derimod) KİRA dağıtılmaz (manuel).
 *  - IGNORE (pazar): dağıtılmaz.
 *  - POS: burada değil (satışa dayalı, masrafMatrix'te üretilir).
 *
 * Çıktı: matrix[kategori][ay 1-12][mağaza kodu] = TL.
 * Marka registry + kurallar: src/lib/masraf/brands.ts, docs/MASRAF-MUHASEBE-PLANI.md
 */

export type StoreCell = Record<string, number>; // mağaza kodu → TL
export type FaturaliDagitim = {
  year: number;
  store_count: number; // ÷ böleni (toplam şirket mağazası, kural: 7)
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
  year: number,
  brandKey = "mavi"
): Promise<FaturaliDagitim> {
  const brand = getMasrafBrand(brandKey);
  const codes = brand.stores.map((s) => s.code);

  // ÷ böleni: toplam aktif ŞİRKET mağazası (Mavi + Derimod = 7). Faturalı dosya
  // tüm markaları kapsadığı için böl her zaman toplam mağaza sayısıdır.
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
  const kira: Record<number, number> = {}; // ay → kira toplam

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

  // Normal kategoriler — aylık ÷7, markanın her mağazasına eşit pay
  for (const [cat, byMonth] of Object.entries(normal)) {
    for (const [monthStr, total] of Object.entries(byMonth)) {
      const month = Number(monthStr);
      const per = total / storeCount;
      for (const code of codes) add(cat, month, code, per);
    }
  }

  // Market — ÷7 her mağaza payı → ½ TEMİZLİK + ½ YEMEK
  for (const [monthStr, total] of Object.entries(market)) {
    const month = Number(monthStr);
    const per = total / storeCount;
    const half = per / 2;
    for (const code of codes) {
      add("TEMIZLIK", month, code, half);
      add("YEMEK", month, code, half);
    }
  }

  // Kira — tamamı markanın kira mağazasına (bölünmez). null ise dağıtılmaz (manuel).
  if (brand.kiraStoreCode) {
    for (const [monthStr, total] of Object.entries(kira)) {
      add("KIRA", Number(monthStr), brand.kiraStoreCode, total);
    }
  }

  return {
    year,
    store_count: storeCount,
    matrix,
    total_distributed: Math.round(totalDistributed * 100) / 100,
  };
}

// POS gideri oranı (gösterim — sabit %5; gerçek komisyon Gider Analizi'nde)
const POS_RATE = 0.05;

/** Mağaza adından Mavi kodu (9400-9403); Mavi değilse null. (Geriye dönük uyum.) */
export function maviCodeFromName(name: string): string | null {
  return brandCodeFromName(getMasrafBrand("mavi"), name);
}

export type MatrixCell = {
  total: number;
  invoiced: number; // faturalı ÷7 dağıtım payı
  cash: number; // mağazanın kendi kasa masrafı
  pos: number; // POS %5
  defolu: number; // İndirim Kontrol push (DEFOLU kategorisi)
};
export type MasrafMatrix = {
  year: number;
  brand: string;
  store_count: number;
  /** kategori → ay(1-12) → mağaza kodu → hücre (kaynak ayrımıyla) */
  matrix: Record<string, Record<number, Record<string, MatrixCell>>>;
};

/** Markanın mağazalarının DB id → çıktı kodu eşlemesi (brand-scoped; sızıntı yok). */
async function buildStoreCodeMap(
  prisma: PrismaClient,
  brand: MasrafBrand
): Promise<Map<string, string>> {
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
 * BİRLEŞİK MASRAF MATRİSİ (Faz 3b+3c, Faz 6'da brand-parametrik).
 * Faturalı ÷7 dağıtım + markanın kasa masrafı (açıklamadan kategorize) + POS %5 +
 * DEFOLU push. Kaynak ayrımı (invoiced/cash/pos/defolu) korunur — şeffaflık.
 * Mağaza eşleştirmesi brand_id ile sınırlı (markalar arası sızıntı yok).
 */
export async function masrafMatrix(
  prisma: PrismaClient,
  year: number,
  brandKey = "mavi"
): Promise<MasrafMatrix> {
  const brand = getMasrafBrand(brandKey);
  const fatura = await faturaliDagitim(prisma, year, brandKey);
  const idToCode = await buildStoreCodeMap(prisma, brand);

  const matrix: Record<string, Record<number, Record<string, MatrixCell>>> = {};
  const cell = (cat: string, month: number, code: string): MatrixCell => {
    const c = (((matrix[cat] ??= {})[month] ??= {})[code] ??= {
      total: 0,
      invoiced: 0,
      cash: 0,
      pos: 0,
      defolu: 0,
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

  // 2) Kasa masrafı — markanın Expense + CashAdvance (bonus/avans hariç).
  //    Açıklamadan kategorize, mağazanın KENDİSİNE (dağıtım yok). Market ½/½.
  const addCash = (
    code: string,
    month: number,
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
    where: {
      expense_date: { gte: yStart, lt: yEnd },
      daily_record: { store: { brand: { name: brand.brandName } } },
    },
    select: {
      amount_try: true,
      description: true,
      expense_date: true,
      daily_record: { select: { store: { select: { id: true } } } },
    },
  });
  for (const e of expenses) {
    const code = idToCode.get(e.daily_record.store.id);
    if (!code) continue;
    addCash(code, e.expense_date.getUTCMonth() + 1, e.description, num(e.amount_try));
  }

  const advances = await prisma.cashAdvance.findMany({
    where: {
      category: { not: "bonus" }, // avans (bonus) ayrı takip — masraf değil
      daily_record: {
        date: { gte: yStart, lt: yEnd },
        store: { brand: { name: brand.brandName } },
      },
    },
    select: {
      amount_try: true,
      description: true,
      daily_record: { select: { date: true, store: { select: { id: true } } } },
    },
  });
  for (const a of advances) {
    const code = idToCode.get(a.daily_record.store.id);
    if (!code) continue;
    addCash(code, a.daily_record.date.getUTCMonth() + 1, a.description, num(a.amount_try));
  }

  // 3) POS %5 — markanın her mağazasının aylık satışı (kilitli günler) × %5
  const summaries = await prisma.storeSummary.findMany({
    where: {
      daily_record: {
        date: { gte: yStart, lt: yEnd },
        status: "locked",
        store: { brand: { name: brand.brandName } },
      },
    },
    select: {
      sales_total_try: true,
      daily_record: { select: { date: true, store: { select: { id: true } } } },
    },
  });
  for (const s of summaries) {
    const code = idToCode.get(s.daily_record.store.id);
    if (!code) continue;
    const sales = num(s.sales_total_try);
    if (sales <= 0) continue;
    const month = s.daily_record.date.getUTCMonth() + 1;
    const posCost = Math.round(sales * POS_RATE * 100) / 100;
    const c = cell("POS", month, code);
    c.pos += posCost;
    c.total += posCost;
  }

  // 4) DEFOLU — İndirim Kontrol push. Markanın mağaza kodlarına göre filtrelenir.
  const brandCodes = brand.stores.map((s) => s.code);
  const defoluRows = await prisma.defoluEntry.findMany({
    where: { period_year: year, store_code: { in: brandCodes } },
    select: { period_month: true, store_code: true, amount_try: true },
  });
  for (const d of defoluRows) {
    const amt = num(d.amount_try);
    if (amt === 0) continue;
    const c = cell("DEFOLU", d.period_month, d.store_code);
    c.defolu += amt;
    c.total += amt;
  }

  return { year, brand: brandKey, store_count: fatura.store_count, matrix };
}
