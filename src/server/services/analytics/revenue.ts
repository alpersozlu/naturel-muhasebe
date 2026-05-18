import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

export type RevenueSummary = {
  total: number;
  cash: number;
  pos: number;
  loyalty: number;
  daily_avg: number;
  active_days: number;
  daily_series: Array<{ day: number; cash: number; pos: number; total: number }>;
  by_store: Array<{ store_id: string; store_name: string; total: number }>;
  by_bank: Array<{ bank_name: string; total: number }>;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

export async function revenueSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<RevenueSummary> {
  const start = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const end = new Date(Date.UTC(filter.year, filter.month, 1));

  // Resolve store scope (brand → all stores under brand)
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const recordWhere = {
    date: { gte: start, lt: end },
    ...(storeIds ? { store_id: { in: storeIds } } : {}),
  };

  // Store summaries (= source of revenue truth)
  const summaries = await prisma.storeSummary.findMany({
    where: { daily_record: recordWhere },
    include: {
      daily_record: { include: { store: true } },
    },
  });

  // POS slips for bank breakdown
  const posSlips = await prisma.posSlip.findMany({
    where: {
      daily_record: recordWhere,
      upload: { status: { in: ["parsed", "confirmed"] } },
    },
  });

  let total = 0;
  let cash = 0;
  let pos = 0;
  let loyalty = 0;
  const activeDays = new Set<string>();
  const daily: Record<number, { cash: number; pos: number; total: number }> = {};
  const byStoreMap: Record<string, { name: string; total: number }> = {};

  for (const s of summaries) {
    const dayN = s.daily_record.date.getUTCDate();
    const sCash = num(s.cash_sales_try);
    const sCC = num(s.credit_card_total_try);
    const sTotal = num(s.sales_total_try);
    const sLoyalty = num(s.loyalty_points_total_try);

    total += sTotal;
    cash += sCash;
    pos += sCC;
    loyalty += sLoyalty;
    activeDays.add(s.daily_record.date.toISOString());

    daily[dayN] ??= { cash: 0, pos: 0, total: 0 };
    daily[dayN].cash += sCash;
    daily[dayN].pos += sCC;
    daily[dayN].total += sTotal;

    const sid = s.daily_record.store_id;
    byStoreMap[sid] ??= { name: s.daily_record.store.name, total: 0 };
    byStoreMap[sid].total += sTotal;
  }

  // Bank breakdown from POS slips
  const byBankMap: Record<string, number> = {};
  for (const p of posSlips) {
    const bank = p.bank_name ?? "Bilinmeyen";
    byBankMap[bank] = (byBankMap[bank] ?? 0) + num(p.net_amount_try);
  }

  const daysInMonth = new Date(Date.UTC(filter.year, filter.month, 0)).getUTCDate();
  const daily_series = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const v = daily[d] ?? { cash: 0, pos: 0, total: 0 };
    return { day: d, ...v };
  });

  const by_store = Object.entries(byStoreMap)
    .map(([id, { name, total }]) => ({ store_id: id, store_name: name, total }))
    .sort((a, b) => b.total - a.total);

  const by_bank = Object.entries(byBankMap)
    .map(([bank_name, total]) => ({ bank_name, total }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    cash,
    pos,
    loyalty,
    daily_avg: activeDays.size > 0 ? total / activeDays.size : 0,
    active_days: activeDays.size,
    daily_series,
    by_store,
    by_bank,
  };
}
