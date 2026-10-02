import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { computeLine, type EntryLike, type LineCalc, type LineInput } from "./compute";
import { periodLabel } from "./rules";

export const num = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);
const n0 = (v: Prisma.Decimal | number | null | undefined): number => Number(v ?? 0);

export const lineInclude = {
  employee: true,
  store: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
  entries: {
    include: { batch: { select: { id: true, status: true, title: true } } },
    orderBy: [{ entry_date: "asc" }, { created_at: "asc" }],
  },
} satisfies Prisma.PayrollLineInclude;

export type LineWithRels = Prisma.PayrollLineGetPayload<{ include: typeof lineInclude }>;

export function isoDate(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export function toEntryLike(e: LineWithRels["entries"][number]): EntryLike {
  return {
    id: e.id,
    kind: e.kind,
    category: e.category,
    channel: e.channel,
    entry_date: isoDate(e.entry_date),
    amount: n0(e.amount),
    note: e.note,
    reference: e.reference,
    voided_at: e.voided_at ? e.voided_at.toISOString() : null,
    batch: e.batch ? { id: e.batch.id, status: e.batch.status, title: e.batch.title } : null,
  };
}

export function toLineInput(l: LineWithRels): LineInput {
  return {
    base_salary: n0(l.base_salary),
    commission_profile: l.commission_profile,
    overtime_hours: n0(l.overtime_hours),
    own_revenue_nd: num(l.own_revenue_nd),
    own_revenue_denim: num(l.own_revenue_denim),
    own_revenue: num(l.own_revenue),
    own_target: num(l.own_target),
    achievement_accepted: num(l.achievement_accepted),
    commission_override: num(l.commission_override),
    commission_note: l.commission_note,
    perfume_units: l.perfume_units,
    garment_units: l.garment_units,
    top_seller: l.top_seller,
    extra_premium: n0(l.extra_premium),
    extra_premium_note: l.extra_premium_note,
    paid_month_early: l.employee.paid_month_early,
    status: l.employee.status,
  };
}

/** Sıralama: müdür → müdür yrd. → kıdemli → asistan → kasiyer → depo → lojistik */
export function positionRank(position: string): number {
  const p = position.toLocaleLowerCase("tr");
  if (p.includes("mağaza müdürü") || p === "müdür") return 0;
  if (p.includes("yardımcısı")) return 1;
  if (p.includes("kıdemli")) return 2;
  if (p.includes("asistan") || p.includes("danışman")) return 3;
  if (p.includes("kasiyer")) return 4;
  if (p.includes("depo")) return 5;
  if (p.includes("lojistik")) return 6;
  return 7;
}

export type ComputedLine = {
  id: string;
  period_id: string;
  employee_id: string;
  store_id: string;
  store_name: string;
  brand_name: string;
  full_name: string;
  position: string;
  commission_profile: LineInput["commission_profile"];
  pay_method: "garanti" | "ziraat" | "cash";
  bank_account_name: string | null;
  has_bank_details: boolean;
  employee_status: "active" | "inactive" | "left";
  end_date: string | null;
  paid_month_early: boolean;
  perfume_eligible: boolean;
  garment_eligible: boolean;
  employee_notes: string | null;
  base_salary: number;
  overtime_hours: number;
  overtime_note: string | null;
  own_revenue_nd: number | null;
  own_revenue_denim: number | null;
  own_revenue: number | null;
  own_target: number | null;
  achievement_accepted: number | null;
  commission_override: number | null;
  commission_note: string | null;
  perfume_units: number;
  garment_units: number;
  top_seller: boolean;
  extra_premium: number;
  extra_premium_note: string | null;
  note: string | null;
  updated_at: string;
  calc: LineCalc;
};

export function computeFromLine(
  l: LineWithRels,
  store: { revenue: number | null; target: number | null }
): ComputedLine {
  const input = toLineInput(l);
  const calc = computeLine(input, store, l.entries.map(toEntryLike));
  const e = l.employee;
  return {
    id: l.id,
    period_id: l.period_id,
    employee_id: l.employee_id,
    store_id: l.store_id,
    store_name: l.store.name,
    brand_name: l.store.brand.name,
    full_name: e.full_name,
    position: l.position,
    commission_profile: l.commission_profile,
    pay_method: e.pay_method,
    bank_account_name: e.bank_account_name,
    has_bank_details: !!(e.bank_branch_code && e.bank_account_no),
    employee_status: e.status,
    end_date: e.end_date ? isoDate(e.end_date) : null,
    paid_month_early: e.paid_month_early,
    perfume_eligible: e.perfume_eligible,
    garment_eligible: e.garment_eligible,
    employee_notes: e.notes,
    base_salary: input.base_salary,
    overtime_hours: input.overtime_hours,
    overtime_note: l.overtime_note,
    own_revenue_nd: input.own_revenue_nd,
    own_revenue_denim: input.own_revenue_denim,
    own_revenue: input.own_revenue,
    own_target: input.own_target,
    achievement_accepted: input.achievement_accepted,
    commission_override: input.commission_override,
    commission_note: l.commission_note,
    perfume_units: l.perfume_units,
    garment_units: l.garment_units,
    top_seller: l.top_seller,
    extra_premium: input.extra_premium,
    extra_premium_note: l.extra_premium_note,
    note: l.note,
    updated_at: l.updated_at.toISOString(),
    calc,
  };
}

export type StoreBlock = {
  store_id: string;
  store_name: string;
  brand_name: string;
  is_mavi: boolean;
  revenue: number | null;
  target: number | null;
  revenue_source: string | null;
  notes: string | null;
  achievement: number | null;
  lines: ComputedLine[];
  totals: { base: number; gross: number; paid: number; remaining: number; advances: number; open: number };
};

export type PeriodView = {
  period: {
    id: string;
    year: number;
    month: number;
    label: string;
    status: "open" | "closed";
    notes: string | null;
    closed_at: string | null;
  };
  stores: StoreBlock[];
  totals: {
    people: number;
    base: number;
    overtime: number;
    commission: number;
    premiums: number;
    deductions: number;
    gross: number;
    advances: number;
    payments: number;
    paid: number;
    remaining: number;
    open: number;
    warnings: number;
    /** Baz maaşı olan kişi sayısı ve bunlardan maaşı tamamen ödenenler */
    base_lines: number;
    base_paid_count: number;
    /** Maaşı ödenmişlerde bekleyen ekstralar (Ödeme 2) */
    extras_pending: number;
  };
  batches: Array<{
    id: string;
    kind: "advance" | "payment1" | "payment2" | "single";
    channel: "garanti" | "ziraat" | "cash" | "other";
    status: "prepared" | "sent" | "void";
    pay_date: string;
    title: string;
    total: number;
    count: number;
    file_name: string | null;
    created_at: string;
    sent_at: string | null;
  }>;
  alerts: Array<{ line_id: string; full_name: string; store_name: string; level: "info" | "warn" | "error"; text: string; code: string }>;
};

export async function loadPeriodView(prisma: PrismaClient, periodId: string): Promise<PeriodView | null> {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    include: {
      store_months: true,
      batches: { orderBy: { created_at: "desc" } },
      lines: { include: lineInclude },
    },
  });
  if (!period) return null;

  const stores = await prisma.store.findMany({
    where: { deleted_at: null },
    include: { brand: { select: { name: true } } },
  });
  const sm = new Map(period.store_months.map((s) => [s.store_id, s]));

  const blocks: StoreBlock[] = stores
    .map((s) => {
      const m = sm.get(s.id);
      const storeIn = { revenue: num(m?.revenue), target: num(m?.target) };
      const lines = period.lines
        .filter((l) => l.store_id === s.id)
        .map((l) => computeFromLine(l, storeIn))
        .sort(
          (a, b) =>
            positionRank(a.position) - positionRank(b.position) ||
            a.full_name.localeCompare(b.full_name, "tr")
        );
      const totals = lines.reduce(
        (t, l) => {
          t.base += l.base_salary;
          t.gross += l.calc.gross;
          t.paid += l.calc.paid_total;
          t.remaining += l.calc.net_remaining;
          t.advances += l.calc.advances_total;
          if (Math.abs(l.calc.net_remaining) > 0.5) t.open += 1;
          return t;
        },
        { base: 0, gross: 0, paid: 0, remaining: 0, advances: 0, open: 0 }
      );
      return {
        store_id: s.id,
        store_name: s.name,
        brand_name: s.brand.name,
        is_mavi: /mavi/i.test(s.brand.name),
        revenue: storeIn.revenue,
        target: storeIn.target,
        revenue_source: m?.revenue_source ?? null,
        notes: m?.notes ?? null,
        achievement: storeIn.revenue && storeIn.target ? storeIn.revenue / storeIn.target : null,
        lines,
        totals,
      };
    })
    .filter((b) => b.lines.length > 0 || true)
    .sort((a, b) => Number(b.is_mavi) - Number(a.is_mavi) || a.store_name.localeCompare(b.store_name, "tr"));

  const all = blocks.flatMap((b) => b.lines);
  const sum = (f: (l: ComputedLine) => number) => Math.round(all.reduce((s, l) => s + f(l), 0) * 100) / 100;
  const totals: PeriodView["totals"] = {
    people: all.length,
    base: sum((l) => l.base_salary),
    overtime: sum((l) => l.calc.overtime_amount),
    commission: sum((l) => l.calc.commission.final),
    premiums: sum(
      (l) => l.calc.perfume_amount + l.calc.garment_amount + l.calc.top_seller_amount + l.calc.extra_premium + l.calc.additions_total
    ),
    deductions: sum((l) => l.calc.deductions_total),
    gross: sum((l) => l.calc.gross),
    advances: sum((l) => l.calc.advances_total),
    payments: sum((l) => l.calc.payments_total),
    paid: sum((l) => l.calc.paid_total),
    remaining: sum((l) => l.calc.net_remaining),
    open: all.filter((l) => Math.abs(l.calc.net_remaining) > 0.5).length,
    warnings: all.reduce((s, l) => s + l.calc.flags.filter((f) => f.level !== "info").length, 0),
    base_lines: all.filter((l) => l.base_salary > 0).length,
    base_paid_count: all.filter((l) => l.base_salary > 0 && l.calc.base_paid).length,
    extras_pending: sum((l) => (l.calc.base_paid ? l.calc.payment2_due : 0)),
  };

  const alerts = all.flatMap((l) =>
    l.calc.flags
      .filter((f) => f.level !== "info")
      .map((f) => ({ line_id: l.id, full_name: l.full_name, store_name: l.store_name, level: f.level, text: f.text, code: f.code }))
  );

  return {
    period: {
      id: period.id,
      year: period.year,
      month: period.month,
      label: periodLabel(period.year, period.month),
      status: period.status,
      notes: period.notes,
      closed_at: period.closed_at ? period.closed_at.toISOString() : null,
    },
    stores: blocks,
    totals,
    batches: period.batches.map((b) => ({
      id: b.id,
      kind: b.kind,
      channel: b.channel,
      status: b.status,
      pay_date: isoDate(b.pay_date),
      title: b.title,
      total: n0(b.total),
      count: b.count,
      file_name: b.file_name,
      created_at: b.created_at.toISOString(),
      sent_at: b.sent_at ? b.sent_at.toISOString() : null,
    })),
    alerts,
  };
}

/**
 * Dönemi bul/oluştur ve satırlarını tamamla: aktif + pasif çalışanlar ve
 * dönem başından sonra ayrılanlar. Var olan satıra dokunulmaz.
 */
export async function ensurePeriod(prisma: PrismaClient, year: number, month: number) {
  const period = await prisma.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    create: { year, month },
    update: {},
  });
  await ensureLines(prisma, period.id);
  return period;
}

export async function ensureLines(prisma: PrismaClient, periodId: string): Promise<number> {
  const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1));
  const employees = await prisma.payrollEmployee.findMany({
    where: {
      deleted_at: null,
      OR: [{ status: { in: ["active", "inactive"] } }, { status: "left", end_date: { gte: periodStart } }],
    },
  });
  const existing = new Set(
    (await prisma.payrollLine.findMany({ where: { period_id: periodId }, select: { employee_id: true } })).map(
      (l) => l.employee_id
    )
  );
  const missing = employees.filter((e) => !existing.has(e.id));
  if (missing.length > 0) {
    await prisma.payrollLine.createMany({
      data: missing.map((e) => ({
        period_id: periodId,
        employee_id: e.id,
        store_id: e.store_id,
        position: e.position,
        commission_profile: e.commission_profile,
        base_salary: e.base_salary,
      })),
    });
  }
  const stores = await prisma.store.findMany({ where: { deleted_at: null }, select: { id: true } });
  for (const s of stores) {
    await prisma.payrollStoreMonth.upsert({
      where: { period_id_store_id: { period_id: periodId, store_id: s.id } },
      create: { period_id: periodId, store_id: s.id },
      update: {},
    });
  }
  return missing.length;
}

export function nextPeriodKey(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}
