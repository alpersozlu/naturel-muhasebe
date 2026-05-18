import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ExpenseFilter } from "@/lib/zod-schemas/analytics";

export type ExpenseSummary = {
  total: number;
  count: number;
  monthly_trend: Array<{ month: string; total: number }>;
  by_category: Array<{ category: string; total: number; count: number }>;
  by_store: Array<{ store_id: string; store_name: string; total: number }>;
  by_employee: Array<{
    employee_id: string | null;
    employee_name: string;
    total: number;
  }>;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Oca",
  "Şub",
  "Mar",
  "Nis",
  "May",
  "Haz",
  "Tem",
  "Ağu",
  "Eyl",
  "Eki",
  "Kas",
  "Ara",
];

export async function expenseSummary(
  prisma: PrismaClient,
  filter: ExpenseFilter
): Promise<ExpenseSummary> {
  // For the selected month
  const monthStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const monthEnd = new Date(Date.UTC(filter.year, filter.month, 1));
  // For trend: last 6 months
  const trendStart = new Date(Date.UTC(filter.year, filter.month - 6, 1));

  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const baseWhere = {
    ...(storeIds ? { daily_record: { store_id: { in: storeIds } } } : {}),
    ...(filter.category ? { category: filter.category } : {}),
  };

  // Current month - expenses (faturalar)
  const expenses = await prisma.expense.findMany({
    where: {
      ...baseWhere,
      expense_date: { gte: monthStart, lt: monthEnd },
    },
    include: {
      daily_record: { include: { store: true } },
      employee: { select: { full_name: true, email: true } },
    },
  });

  // Cash advances also count as expense
  const advances = await prisma.cashAdvance.findMany({
    where: {
      ...(storeIds ? { daily_record: { store_id: { in: storeIds } } } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.employee_id ? { employee_id: filter.employee_id } : {}),
      daily_record: {
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
        date: { gte: monthStart, lt: monthEnd },
      },
    },
    include: {
      daily_record: { include: { store: true } },
      employee: { select: { full_name: true, email: true } },
    },
  });

  // Trend window
  const trendExpenses = await prisma.expense.findMany({
    where: {
      ...baseWhere,
      expense_date: { gte: trendStart, lt: monthEnd },
    },
    select: { expense_date: true, amount_try: true },
  });
  const trendAdvances = await prisma.cashAdvance.findMany({
    where: {
      ...(storeIds ? { daily_record: { store_id: { in: storeIds } } } : {}),
      daily_record: {
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
        date: { gte: trendStart, lt: monthEnd },
      },
    },
    select: { created_at: true, amount_try: true, daily_record: { select: { date: true } } },
  });

  let total = 0;
  const byCategoryMap: Record<string, { total: number; count: number }> = {};
  const byStoreMap: Record<string, { name: string; total: number }> = {};
  const byEmployeeMap: Record<string, { name: string; total: number }> = {};

  for (const e of expenses) {
    const v = num(e.amount_try);
    total += v;
    byCategoryMap[e.category] ??= { total: 0, count: 0 };
    byCategoryMap[e.category].total += v;
    byCategoryMap[e.category].count += 1;

    const sid = e.daily_record.store_id;
    byStoreMap[sid] ??= { name: e.daily_record.store.name, total: 0 };
    byStoreMap[sid].total += v;

    if (e.employee) {
      const empKey = e.employee_id ?? "_";
      byEmployeeMap[empKey] ??= {
        name: e.employee.full_name ?? e.employee.email,
        total: 0,
      };
      byEmployeeMap[empKey].total += v;
    }
  }

  for (const a of advances) {
    const v = num(a.amount_try);
    total += v;
    byCategoryMap[a.category] ??= { total: 0, count: 0 };
    byCategoryMap[a.category].total += v;
    byCategoryMap[a.category].count += 1;

    const sid = a.daily_record.store_id;
    byStoreMap[sid] ??= { name: a.daily_record.store.name, total: 0 };
    byStoreMap[sid].total += v;

    const empKey = a.employee_id;
    byEmployeeMap[empKey] ??= {
      name: a.employee.full_name ?? a.employee.email,
      total: 0,
    };
    byEmployeeMap[empKey].total += v;
  }

  // Monthly trend (last 6 months)
  const monthlyMap: Record<string, number> = {};
  for (const e of trendExpenses) {
    const y = e.expense_date.getUTCFullYear();
    const m = e.expense_date.getUTCMonth();
    const key = `${y}-${m}`;
    monthlyMap[key] = (monthlyMap[key] ?? 0) + num(e.amount_try);
  }
  for (const a of trendAdvances) {
    const y = a.daily_record.date.getUTCFullYear();
    const m = a.daily_record.date.getUTCMonth();
    const key = `${y}-${m}`;
    monthlyMap[key] = (monthlyMap[key] ?? 0) + num(a.amount_try);
  }
  const monthly_trend: Array<{ month: string; total: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date(Date.UTC(filter.year, filter.month - 1 - i, 1));
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    monthly_trend.push({
      month: `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      total: monthlyMap[key] ?? 0,
    });
  }

  return {
    total,
    count: expenses.length + advances.length,
    monthly_trend,
    by_category: Object.entries(byCategoryMap)
      .map(([category, v]) => ({ category, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total),
    by_store: Object.entries(byStoreMap)
      .map(([id, v]) => ({ store_id: id, store_name: v.name, total: v.total }))
      .sort((a, b) => b.total - a.total),
    by_employee: Object.entries(byEmployeeMap)
      .map(([id, v]) => ({
        employee_id: id === "_" ? null : id,
        employee_name: v.name,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total),
  };
}
