import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

/**
 * AVANS TAKİP — maaştan kesinti için aylık, kişi bazlı tarihli avans dökümü.
 * Sadece category=bonus (Prim/Avans) kayıtları. Kişi = staff_name (+ rol).
 * Aynı kişi ay içinde birden çok avans aldıysa hepsi tarihli listelenir + toplam.
 */
export type AdvanceEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  store_name: string;
  note: string | null;
};

export type AdvancePerson = {
  staff_name: string;
  staff_role: string | null; // manager | assistant_manager | sales_staff
  entries: AdvanceEntry[];
  total: number;
};

export type AdvancesSummary = {
  period_label: string;
  year: number;
  month: number;
  people: AdvancePerson[];
  grand_total: number;
  entry_count: number;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export async function advancesSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<AdvancesSummary> {
  const monthStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const monthEnd = new Date(Date.UTC(filter.year, filter.month, 1));

  // Mağaza scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const advances = await prisma.cashAdvance.findMany({
    where: {
      category: "bonus",
      daily_record: {
        date: { gte: monthStart, lt: monthEnd },
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
      },
    },
    select: {
      id: true,
      amount_try: true,
      staff_name: true,
      staff_role: true,
      description: true,
      daily_record: {
        select: { date: true, store: { select: { name: true } } },
      },
    },
    orderBy: { daily_record: { date: "asc" } },
  });

  // Kişi bazlı grupla — anahtar: staff_name (normalize) + role
  const byPerson = new Map<string, AdvancePerson>();
  let grandTotal = 0;

  for (const a of advances) {
    const name = (a.staff_name ?? "İsimsiz").trim();
    const role = a.staff_role ?? null;
    const key = `${name.toLocaleLowerCase("tr")}|${role ?? ""}`;
    const amount = num(a.amount_try);
    grandTotal += amount;

    let person = byPerson.get(key);
    if (!person) {
      person = { staff_name: name, staff_role: role, entries: [], total: 0 };
      byPerson.set(key, person);
    }
    person.entries.push({
      id: a.id,
      date: a.daily_record.date.toISOString().slice(0, 10),
      amount,
      store_name: a.daily_record.store.name,
      note: a.description,
    });
    person.total += amount;
  }

  const people = Array.from(byPerson.values()).sort(
    (a, b) => b.total - a.total
  );

  return {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    year: filter.year,
    month: filter.month,
    people,
    grand_total: grandTotal,
    entry_count: advances.length,
  };
}
