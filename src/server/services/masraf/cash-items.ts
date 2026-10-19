import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getMasrafBrand } from "@/lib/masraf/brands";
import { buildStoreCodeMap, resolveCashCategory } from "./dagitim";

/**
 * Bir ayın KASA kalemleri (mağazanın yüklediği masraf fişleri + faturasız peşin
 * ödemeler) — masraf satırıyla birlikte. Yönetici satırı düzeltebilir
 * (Expense.masraf_category / CashAdvance.masraf_category); "DİĞER + gözden geçir"
 * olanlar listede öne çıkar ("others = kategorisi bulunamayan masraflar").
 */
export type CashItem = {
  source: "expense" | "cash_advance";
  id: string;
  store_code: string;
  store_label: string;
  date: string;
  vendor: string | null;
  description: string | null;
  store_category: string; // ExpenseCategory
  amount_try: number;
  category: string; // çözülen masraf satırı
  auto_category: string;
  overridden: boolean;
  needs_review: boolean;
  document_no: string | null;
  upload_id: string | null;
  /** sahibi bu fişin fotoğrafını da yüklediyse (mağaza faturası eşleşmesi) */
  photo_id: string | null;
};

export async function masrafCashItems(prisma: PrismaClient, year: number, month: number, brandKey = "mavi"): Promise<CashItem[]> {
  const brand = getMasrafBrand(brandKey);
  const idToCode = await buildStoreCodeMap(prisma, brand);
  const labels = Object.fromEntries(brand.stores.map((s) => [s.code, s.label]));
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const [expenses, advances] = await Promise.all([
    prisma.expense.findMany({
      where: { expense_date: { gte: from, lt: to }, daily_record: { store: { brand: { name: brand.brandName } } } },
      select: {
        id: true, vendor: true, description: true, category: true, amount_try: true, expense_date: true, document_no: true, masraf_category: true, upload_id: true,
        daily_record: { select: { store_id: true } },
        masraf_invoices: { where: { deleted_at: null }, select: { id: true }, take: 1 },
      },
      orderBy: { expense_date: "asc" },
    }),
    prisma.cashAdvance.findMany({
      where: { category: { not: "bonus" }, daily_record: { date: { gte: from, lt: to }, store: { brand: { name: brand.brandName } } } },
      select: { id: true, description: true, category: true, amount_try: true, masraf_category: true, daily_record: { select: { date: true, store_id: true } } },
      orderBy: { daily_record: { date: "asc" } },
    }),
  ]);

  const items: CashItem[] = [];
  for (const e of expenses) {
    const code = idToCode.get(e.daily_record.store_id);
    if (!code) continue;
    const r = resolveCashCategory(e);
    items.push({
      source: "expense", id: e.id, store_code: code, store_label: labels[code] ?? code, date: e.expense_date.toISOString().slice(0, 10),
      vendor: e.vendor, description: e.description, store_category: e.category, amount_try: Number(e.amount_try),
      category: r.category, auto_category: r.auto, overridden: r.overridden, needs_review: r.needsReview,
      document_no: e.document_no && e.document_no !== "?" ? e.document_no : null, upload_id: e.upload_id, photo_id: e.masraf_invoices[0]?.id ?? null,
    });
  }
  for (const a of advances) {
    const code = idToCode.get(a.daily_record.store_id);
    if (!code) continue;
    const r = resolveCashCategory({ ...a, vendor: null });
    items.push({
      source: "cash_advance", id: a.id, store_code: code, store_label: labels[code] ?? code, date: a.daily_record.date.toISOString().slice(0, 10),
      vendor: null, description: a.description, store_category: a.category, amount_try: Number(a.amount_try),
      category: r.category, auto_category: r.auto, overridden: r.overridden, needs_review: r.needsReview,
      document_no: null, upload_id: null, photo_id: null,
    });
  }
  return items.sort((x, y) => x.date.localeCompare(y.date) || x.store_code.localeCompare(y.store_code));
}
