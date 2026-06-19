import "server-only";
import type { PrismaClient } from "@prisma/client";

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
