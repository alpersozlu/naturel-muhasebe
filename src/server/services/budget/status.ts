import "server-only";
import type { PrismaClient, BudgetLimit } from "@prisma/client";

export type BudgetAlertStatus = "ok" | "warning" | "exceeded";

export type BudgetLimitStatus = {
  id: string;
  name: string | null;
  store_id: string | null;
  store_name: string | null;
  brand_name: string | null;
  scope: BudgetLimit["scope"];
  category: BudgetLimit["category"];
  mode: BudgetLimit["mode"];
  amount_try: number | null;
  ratio_pct: number | null;
  period: BudgetLimit["period"];
  period_start: string;
  period_end: string;
  period_label: string;
  alert_pct: number;
  is_active: boolean;
  notes: string | null;
  /** mode=ratio için: kilitli günlerin StoreSummary toplam satışı */
  revenue_base: number;
  /** Limit tutarı (TRY) — mode=amount ise amount_try, mode=ratio ise revenue_base × ratio_pct / 100 */
  limit_try: number;
  /** Dönemde harcanan toplam (Expense + CashAdvance, ilgili scope) */
  spent_try: number;
  /** spent / limit × 100 — limit sıfırsa 0 */
  usage_pct: number;
  alert_status: BudgetAlertStatus;
  created_at: Date;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/**
 * Limitin geçerli dönem aralığını ve etiketini hesapla.
 * - monthly: `now`'ın bulunduğu ayın 1'i ↔ ertesi ay 1'i
 * - yearly:  `now`'ın bulunduğu yılın 1 Ocak ↔ ertesi yıl 1 Ocak
 * - custom:  period_start ↔ period_end (+1 gün, exclusive)
 */
function resolvePeriod(
  limit: BudgetLimit,
  now: Date
): { start: Date; end: Date; label: string } {
  if (limit.period === "monthly") {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(y, m, 1)),
      end: new Date(Date.UTC(y, m + 1, 1)),
      label: `${MONTH_LABELS[m]} ${y}`,
    };
  }
  if (limit.period === "yearly") {
    const y = now.getUTCFullYear();
    return {
      start: new Date(Date.UTC(y, 0, 1)),
      end: new Date(Date.UTC(y + 1, 0, 1)),
      label: `${y} Yılı`,
    };
  }
  // custom
  const ps = limit.period_start ?? now;
  const pe = limit.period_end ?? now;
  const end = new Date(pe);
  end.setUTCDate(end.getUTCDate() + 1); // exclusive
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  return {
    start: ps,
    end,
    label: `${fmt(ps)} → ${fmt(pe)}`,
  };
}

export async function computeBudgetStatus(
  prisma: PrismaClient,
  limit: BudgetLimit & {
    store: { name: string; brand: { name: string } } | null;
  },
  now: Date = new Date()
): Promise<BudgetLimitStatus> {
  const { start, end, label } = resolvePeriod(limit, now);

  // Harcama: Expense + CashAdvance
  const storeFilter = limit.store_id
    ? { store_id: limit.store_id }
    : undefined;
  const categoryFilter =
    limit.scope === "category" && limit.category
      ? { category: limit.category }
      : undefined;

  const [expenseAgg, advanceAgg] = await Promise.all([
    prisma.expense.aggregate({
      _sum: { amount_try: true },
      where: {
        expense_date: { gte: start, lt: end },
        ...(storeFilter
          ? { daily_record: { store_id: storeFilter.store_id } }
          : {}),
        ...(categoryFilter ?? {}),
      },
    }),
    prisma.cashAdvance.aggregate({
      _sum: { amount_try: true },
      where: {
        daily_record: {
          date: { gte: start, lt: end },
          ...(storeFilter ? { store_id: storeFilter.store_id } : {}),
        },
        ...(categoryFilter ?? {}),
      },
    }),
  ]);

  const spent = num(expenseAgg._sum.amount_try) + num(advanceAgg._sum.amount_try);

  // Ciro tabanı (mode=ratio için) — sadece kilitli günlerin StoreSummary toplam satışı
  let revenueBase = 0;
  let limitAmount = 0;
  const ratioPct = limit.ratio_pct ? num(limit.ratio_pct) : 0;
  if (limit.mode === "amount") {
    limitAmount = limit.amount_try ? num(limit.amount_try) : 0;
  } else {
    const revenueAgg = await prisma.storeSummary.aggregate({
      _sum: { sales_total_try: true },
      where: {
        daily_record: {
          date: { gte: start, lt: end },
          status: "locked",
          ...(storeFilter ? { store_id: storeFilter.store_id } : {}),
        },
      },
    });
    revenueBase = num(revenueAgg._sum.sales_total_try);
    limitAmount = revenueBase * (ratioPct / 100);
  }

  const usagePct = limitAmount > 0 ? (spent / limitAmount) * 100 : 0;
  const alertPct = num(limit.alert_pct);
  const alertStatus: BudgetAlertStatus =
    usagePct >= 100 ? "exceeded" : usagePct >= alertPct ? "warning" : "ok";

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  return {
    id: limit.id,
    name: limit.name,
    store_id: limit.store_id,
    store_name: limit.store?.name ?? null,
    brand_name: limit.store?.brand.name ?? null,
    scope: limit.scope,
    category: limit.category,
    mode: limit.mode,
    amount_try: limit.amount_try ? num(limit.amount_try) : null,
    ratio_pct: limit.ratio_pct ? num(limit.ratio_pct) : null,
    period: limit.period,
    period_start: isoDate(start),
    period_end: isoDate(end),
    period_label: label,
    alert_pct: alertPct,
    is_active: limit.is_active,
    notes: limit.notes,
    revenue_base: revenueBase,
    limit_try: limitAmount,
    spent_try: spent,
    usage_pct: usagePct,
    alert_status: alertStatus,
    created_at: limit.created_at,
  };
}
