import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";
import { DEFAULT_COMMISSION_RATE } from "./bank-commission";

/**
 * Aylık P&L (Kar/Zarar) Özeti
 *
 * Gelir + banka komisyonu + kategori giderlerini tek bakışta birleştirir:
 *   Brüt Gelir − Komisyon − Gider = Net Kazanç
 *
 * Komisyon şu an varsayılan %5 (banka bazında ilerde override).
 */

export type ProfitLossPeriod = {
  revenue: number;
  commission: number;
  expense: number;
  net: number;
  /** Gider oranı = (commission + expense) / revenue, 0-1 */
  ratio: number;
};

export type ProfitLossSummary = {
  current: ProfitLossPeriod;
  prev_month: ProfitLossPeriod;
  prev_year: ProfitLossPeriod;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

function compute(rev: number, comm: number, exp: number): ProfitLossPeriod {
  const net = rev - comm - exp;
  const ratio = rev > 0 ? (comm + exp) / rev : 0;
  return { revenue: rev, commission: comm, expense: exp, net, ratio };
}

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const ymKey = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")}`;

export async function profitLossSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<ProfitLossSummary> {
  const currentEnd = new Date(Date.UTC(filter.year, filter.month, 1));
  // 13-aylık pencere: geçen yıl aynı aydan cari ay sonuna
  const extStart = new Date(Date.UTC(filter.year - 1, filter.month - 1, 1));

  // Store scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }
  const storeScope = storeIds ? { store_id: { in: storeIds } } : {};

  // 4 paralel query — minimal projection
  const [summaries, slips, expenses, advances] = await Promise.all([
    prisma.storeSummary.findMany({
      where: {
        daily_record: { date: { gte: extStart, lt: currentEnd }, ...storeScope },
      },
      select: {
        sales_total_try: true,
        daily_record: { select: { date: true } },
      },
    }),
    prisma.posSlip.findMany({
      where: {
        daily_record: { date: { gte: extStart, lt: currentEnd }, ...storeScope },
        upload: { status: { in: ["parsed", "confirmed"] } },
      },
      select: {
        net_amount_try: true,
        daily_record: { select: { date: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        expense_date: { gte: extStart, lt: currentEnd },
        ...(storeIds ? { daily_record: { store_id: { in: storeIds } } } : {}),
      },
      select: { amount_try: true, expense_date: true },
    }),
    prisma.cashAdvance.findMany({
      where: {
        daily_record: { date: { gte: extStart, lt: currentEnd }, ...storeScope },
      },
      select: {
        amount_try: true,
        daily_record: { select: { date: true } },
      },
    }),
  ]);

  // Aylık bucket'lar
  const revByMonth: Record<string, number> = {};
  const commByMonth: Record<string, number> = {};
  const expByMonth: Record<string, number> = {};

  for (const s of summaries) {
    const k = monthKey(s.daily_record.date);
    revByMonth[k] = (revByMonth[k] ?? 0) + num(s.sales_total_try);
  }
  for (const p of slips) {
    const k = monthKey(p.daily_record.date);
    commByMonth[k] =
      (commByMonth[k] ?? 0) + num(p.net_amount_try) * DEFAULT_COMMISSION_RATE;
  }
  for (const e of expenses) {
    const k = monthKey(e.expense_date);
    expByMonth[k] = (expByMonth[k] ?? 0) + num(e.amount_try);
  }
  for (const a of advances) {
    const k = monthKey(a.daily_record.date);
    expByMonth[k] = (expByMonth[k] ?? 0) + num(a.amount_try);
  }

  const curKey = ymKey(filter.year, filter.month);
  const prevM =
    filter.month === 1
      ? { y: filter.year - 1, m: 12 }
      : { y: filter.year, m: filter.month - 1 };
  const prevMonthKey = ymKey(prevM.y, prevM.m);
  const prevYearKey = ymKey(filter.year - 1, filter.month);

  return {
    current: compute(
      revByMonth[curKey] ?? 0,
      commByMonth[curKey] ?? 0,
      expByMonth[curKey] ?? 0
    ),
    prev_month: compute(
      revByMonth[prevMonthKey] ?? 0,
      commByMonth[prevMonthKey] ?? 0,
      expByMonth[prevMonthKey] ?? 0
    ),
    prev_year: compute(
      revByMonth[prevYearKey] ?? 0,
      commByMonth[prevYearKey] ?? 0,
      expByMonth[prevYearKey] ?? 0
    ),
  };
}
