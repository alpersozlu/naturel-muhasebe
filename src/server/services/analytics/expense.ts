import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ExpenseFilter } from "@/lib/zod-schemas/analytics";

export type ExpenseSummary = {
  total: number;
  count: number;
  monthly_trend: Array<{ month: string; total: number }>;
  by_category: Array<{ category: string; total: number; count: number }>;
  by_store: Array<{
    store_id: string;
    store_name: string;
    total: number;
    prev_month_total: number;
  }>;
  /** Cari ayın günlük serisi (zero-filled) */
  daily_series: Array<{ day: number; total: number }>;
  by_employee: Array<{
    employee_id: string | null;
    employee_name: string;
    total: number;
  }>;
  /**
   * Yıllık + projeksiyon — kurumsal görünüm için.
   * Filter.year boyunca her ay için: actual = geçmiş aylar (cari ay dahil),
   * projected = gelecek aylar (cari sonrasından Aralık'a kadar).
   * Cari ay her ikisinde de aynı değere sahip ki çizgi sürekli görünsün.
   */
  yearly_with_projection: Array<{
    month: number;
    label: string;
    actual: number | null;
    projected: number | null;
  }>;
  /** Cari yılbaşından cari aya kadar toplam */
  ytd_total: number;
  /** Cari hızda yıl sonuna kadar tahmini toplam */
  projected_year_end: number;
  /** YTD aylık ortalama — projeksiyonun temeli */
  projected_monthly_avg: number;
  /**
   * Mağaza × ay matrisi (filter.year boyunca).
   * Her hücre: faturalı (upload_id var) + faturasız (upload_id null) ayrımı.
   * CashAdvance bu matriste sayılmaz — sadece Expense tablosu.
   */
  by_store_year_matrix: Array<{
    store_id: string;
    store_name: string;
    brand_name: string;
    months: Array<{
      month: number; // 1-12
      invoiced: number;
      uninvoiced: number;
    }>;
    year_invoiced: number;
    year_uninvoiced: number;
    year_total: number;
  }>;
  /** Yıl boyu faturalı/faturasız toplamı (matristeki tüm mağazaların toplamı) */
  year_invoiced_total: number;
  year_uninvoiced_total: number;
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
  // For trend: cari yılın başından cari ay sonuna kadar — YTD + projeksiyon için
  const trendStart = new Date(Date.UTC(filter.year, 0, 1));

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

  // Mağaza × ay matrisi için yıl boyu Expense (faturalı/faturasız ayrımı)
  const yearStart = new Date(Date.UTC(filter.year, 0, 1));
  const yearEnd = new Date(Date.UTC(filter.year + 1, 0, 1));
  const yearExpenses = await prisma.expense.findMany({
    where: {
      ...baseWhere,
      expense_date: { gte: yearStart, lt: yearEnd },
    },
    select: {
      expense_date: true,
      amount_try: true,
      upload_id: true,
      daily_record: {
        select: {
          store_id: true,
          store: {
            select: { name: true, brand: { select: { name: true } } },
          },
        },
      },
    },
  });

  // Matriste hangi mağazaların görüneceği — filtre ile sınırla
  const matrixStoreWhere: { id?: { in: string[] }; brand_id?: string; deleted_at: null } = {
    deleted_at: null,
  };
  if (storeIds) {
    matrixStoreWhere.id = { in: storeIds };
  } else if (filter.brand_id) {
    matrixStoreWhere.brand_id = filter.brand_id;
  }
  const matrixStores = await prisma.store.findMany({
    where: matrixStoreWhere,
    select: { id: true, name: true, brand: { select: { name: true } } },
    orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
  });

  // Trend window — store_id de seçilir ki per-store MoM hesaplanabilsin
  const trendExpenses = await prisma.expense.findMany({
    where: {
      ...baseWhere,
      expense_date: { gte: trendStart, lt: monthEnd },
    },
    select: {
      expense_date: true,
      amount_try: true,
      daily_record: { select: { store_id: true } },
    },
  });
  const trendAdvances = await prisma.cashAdvance.findMany({
    where: {
      ...(storeIds ? { daily_record: { store_id: { in: storeIds } } } : {}),
      daily_record: {
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
        date: { gte: trendStart, lt: monthEnd },
      },
    },
    select: {
      created_at: true,
      amount_try: true,
      daily_record: { select: { date: true, store_id: true } },
    },
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

    const empKey = a.employee_id ?? "_";
    byEmployeeMap[empKey] ??= {
      name: a.employee?.full_name ?? a.employee?.email ?? "Çalışan yok",
      total: 0,
    };
    byEmployeeMap[empKey].total += v;
  }

  // Monthly trend (YTD) + per-store monthly map (MoM için)
  const monthlyMap: Record<string, number> = {};
  // monthlyByStore[store_id][year-monthIdx] = total
  const monthlyByStore: Record<string, Record<string, number>> = {};
  for (const e of trendExpenses) {
    const y = e.expense_date.getUTCFullYear();
    const m = e.expense_date.getUTCMonth();
    const key = `${y}-${m}`;
    const v = num(e.amount_try);
    monthlyMap[key] = (monthlyMap[key] ?? 0) + v;
    const sid = e.daily_record.store_id;
    monthlyByStore[sid] ??= {};
    monthlyByStore[sid]![key] = (monthlyByStore[sid]![key] ?? 0) + v;
  }
  for (const a of trendAdvances) {
    const y = a.daily_record.date.getUTCFullYear();
    const m = a.daily_record.date.getUTCMonth();
    const key = `${y}-${m}`;
    const v = num(a.amount_try);
    monthlyMap[key] = (monthlyMap[key] ?? 0) + v;
    const sid = a.daily_record.store_id;
    monthlyByStore[sid] ??= {};
    monthlyByStore[sid]![key] = (monthlyByStore[sid]![key] ?? 0) + v;
  }

  // Geçen ay (yıl sınırı dahil)
  const prevMonthDate = new Date(Date.UTC(filter.year, filter.month - 2, 1));
  const prevMonthKey = `${prevMonthDate.getUTCFullYear()}-${prevMonthDate.getUTCMonth()}`;

  // Günlük seri — cari ay (zero-filled)
  const daysInMonth = new Date(Date.UTC(filter.year, filter.month, 0)).getUTCDate();
  const dailyMap: Record<number, number> = {};
  for (const e of expenses) {
    const d = e.expense_date.getUTCDate();
    dailyMap[d] = (dailyMap[d] ?? 0) + num(e.amount_try);
  }
  for (const a of advances) {
    const d = a.daily_record.date.getUTCDate();
    dailyMap[d] = (dailyMap[d] ?? 0) + num(a.amount_try);
  }
  const daily_series = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    total: dailyMap[i + 1] ?? 0,
  }));
  // ---- Mevcut monthly_trend: son 6 ay (geriye uyumluluk) ----
  const monthly_trend: Array<{ month: string; total: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date(Date.UTC(filter.year, filter.month - 1 - i, 1));
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    monthly_trend.push({
      month: `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      total: monthlyMap[key] ?? 0,
    });
  }

  // ---- Yıllık seri + projeksiyon ----
  // YTD: filter.year Ocak'tan cari ayın sonuna kadar (cari ay dahil)
  let ytd_total = 0;
  for (let m = 0; m < filter.month; m++) {
    const key = `${filter.year}-${m}`;
    ytd_total += monthlyMap[key] ?? 0;
  }
  // Aylık ortalama — kalan ayları doldurmak için
  const projected_monthly_avg = filter.month > 0 ? ytd_total / filter.month : 0;

  const yearly_with_projection: ExpenseSummary["yearly_with_projection"] = [];
  for (let m = 0; m < 12; m++) {
    const date = new Date(Date.UTC(filter.year, m, 1));
    const key = `${filter.year}-${m}`;
    const monthLabel = `${MONTH_LABELS[m]} ${filter.year}`;
    const monthNumber = m + 1;
    if (monthNumber < filter.month) {
      // Geçmiş ay: sadece actual
      yearly_with_projection.push({
        month: monthNumber,
        label: monthLabel,
        actual: monthlyMap[key] ?? 0,
        projected: null,
      });
    } else if (monthNumber === filter.month) {
      // Cari ay: actual + projeksiyon başlangıç noktası
      const cur = monthlyMap[key] ?? 0;
      yearly_with_projection.push({
        month: monthNumber,
        label: monthLabel,
        actual: cur,
        projected: cur, // çizgilerin birleşmesi için
      });
    } else {
      // Gelecek ay: sadece projected
      yearly_with_projection.push({
        month: monthNumber,
        label: monthLabel,
        actual: null,
        projected: projected_monthly_avg,
      });
    }
    void date; // tip uyumu için tutulan referans
  }
  // Yıl sonu projeksiyon = YTD + (12 - filter.month) × aylık ortalama
  const remainingMonths = Math.max(0, 12 - filter.month);
  const projected_year_end = ytd_total + remainingMonths * projected_monthly_avg;

  // ---- Mağaza × Ay matrisi (faturalı/faturasız) ----
  // matrix[store_id][monthIdx 0-11] = { invoiced, uninvoiced }
  const matrix: Record<string, Array<{ invoiced: number; uninvoiced: number }>> = {};
  for (const s of matrixStores) {
    matrix[s.id] = Array.from({ length: 12 }, () => ({ invoiced: 0, uninvoiced: 0 }));
  }
  let year_invoiced_total = 0;
  let year_uninvoiced_total = 0;
  for (const e of yearExpenses) {
    const sid = e.daily_record.store_id;
    if (!matrix[sid]) continue; // mağaza filter dışındaysa atla
    const monthIdx = e.expense_date.getUTCMonth();
    const v = num(e.amount_try);
    const cell = matrix[sid][monthIdx]!;
    if (e.upload_id) {
      cell.invoiced += v;
      year_invoiced_total += v;
    } else {
      cell.uninvoiced += v;
      year_uninvoiced_total += v;
    }
  }
  const by_store_year_matrix: ExpenseSummary["by_store_year_matrix"] = matrixStores
    .map((s) => {
      const cells = matrix[s.id]!;
      let yearInvoiced = 0;
      let yearUninvoiced = 0;
      const months = cells.map((c, idx) => {
        yearInvoiced += c.invoiced;
        yearUninvoiced += c.uninvoiced;
        return { month: idx + 1, invoiced: c.invoiced, uninvoiced: c.uninvoiced };
      });
      return {
        store_id: s.id,
        store_name: s.name,
        brand_name: s.brand.name,
        months,
        year_invoiced: yearInvoiced,
        year_uninvoiced: yearUninvoiced,
        year_total: yearInvoiced + yearUninvoiced,
      };
    })
    .sort((a, b) => b.year_total - a.year_total);

  return {
    total,
    count: expenses.length + advances.length,
    monthly_trend,
    by_category: Object.entries(byCategoryMap)
      .map(([category, v]) => ({ category, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total),
    by_store: Object.entries(byStoreMap)
      .map(([id, v]) => ({
        store_id: id,
        store_name: v.name,
        total: v.total,
        prev_month_total: monthlyByStore[id]?.[prevMonthKey] ?? 0,
      }))
      .sort((a, b) => b.total - a.total),
    daily_series,
    by_employee: Object.entries(byEmployeeMap)
      .map(([id, v]) => ({
        employee_id: id === "_" ? null : id,
        employee_name: v.name,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total),
    yearly_with_projection,
    ytd_total,
    projected_year_end,
    projected_monthly_avg,
    by_store_year_matrix,
    year_invoiced_total,
    year_uninvoiced_total,
  };
}
