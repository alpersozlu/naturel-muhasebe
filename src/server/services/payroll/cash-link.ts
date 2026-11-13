import "server-only";
import type { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/server/services/payroll/nebim-revenue";

/**
 * KASADAN YAPILAN MAAŞ / PRİM / AVANS ÖDEMESİ → MAAŞLAR (sahibi, 13.11.2026).
 *
 * Mağaza "Faturasız Peşin Ödeme" kartından Maaş ya da Prim/Avans kategorisinde
 * bir ödeme girdiğinde, para o kişinin o ayki bordrosundan düşmek zorundadır;
 * yoksa kişiye iki kez ödenir. Eskiden bağlantı ELLE kuruluyordu (Maaşlar ›
 * Avans adımındaki "Bordroya aktar" listesi) ve atlanabiliyordu.
 *
 * Artık ödeme girilirken kişi mağazanın bordro listesinden SEÇİLİR ve kayıt
 * anında bordroya düşer. Dönem henüz açılmadıysa bağlantı kurulamaz; dönem
 * açılınca (periods.open / ensureLines) geriye dönük kurulur. İsim elle
 * yazıldıysa ve eşleşmediyse eski "Bordroya aktar" listesi devrededir.
 *
 * Bağ `PayrollEntry.cash_advance_id` (unique) üzerinde durur: aynı ödeme iki
 * kez bordroya giremez.
 */

/** Bordroya yansıyan masraf kategorileri. */
export const PAYROLL_CASH_CATEGORIES = ["salary", "bonus"] as const;
export type PayrollCashCategory = (typeof PAYROLL_CASH_CATEGORIES)[number];

export function isPayrollCashCategory(c: string): c is PayrollCashCategory {
  return (PAYROLL_CASH_CATEGORIES as readonly string[]).includes(c);
}

export type CashEntryShape = {
  kind: "advance" | "payment";
  category: string | null;
  note: string;
  reference: string;
};

/**
 * Kasadan ödeme bordroda hangi kayda dönüşür?
 *
 * - Prim/Avans → AVANS: ay içinde elden verilen para, o ayın maaşından düşer.
 * - Maaş → TEKİL ÖDEME: maaşın kasadan ödenen kısmı (Ödeme 1 / Ödeme 2
 *   sahibinin talimatlarıdır, onların yerine geçmez).
 *
 * İkisi de "ödenen"e eklenir, yani Net Kalan'ı azaltır.
 */
export function cashEntryShape(a: {
  category: PayrollCashCategory;
  storeName: string;
  description?: string | null;
}): CashEntryShape {
  const tail = a.description?.trim() ? ` — ${a.description.trim()}` : "";
  if (a.category === "salary") {
    return {
      kind: "payment",
      category: "single",
      note: `Kasadan nakit maaş ödemesi (${a.storeName})${tail}`,
      reference: "DocuFlow kasa ödemesi",
    };
  }
  return {
    kind: "advance",
    category: null,
    note: `Kasadan nakit avans (${a.storeName})${tail}`,
    reference: "DocuFlow kasa avansı",
  };
}

/** Bordro ünvanından peşin ödeme kartındaki personel rolü. */
export function staffRoleFromPosition(position: string): "manager" | "assistant_manager" | "sales_staff" {
  const p = position.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (p.includes("yardim") || p.includes("yrd") || p.includes("asistan müd") || p.includes("asistan mud")) {
    return "assistant_manager";
  }
  if (p.includes("müdür") || p.includes("mudur")) return "manager";
  return "sales_staff";
}

type NamedEmployee = { id: string; store_id: string; full_name: string; aliases: string[]; bank_account_name: string | null };

/**
 * Elle yazılmış isim → bordro personeli. Önce aynı mağaza, sonra tüm kadro;
 * yalnız TEK aday varsa eşleşir (iki Ayşe varsa karar kullanıcıya kalır).
 */
export function matchEmployeeByName<T extends NamedEmployee>(
  name: string,
  storeId: string,
  employees: T[]
): T | null {
  const want = normalizeName(name);
  if (!want) return null;
  const keys = (e: T) =>
    [e.full_name, e.bank_account_name ?? "", ...e.aliases].map(normalizeName).filter(Boolean);
  const hits = employees.filter((e) => keys(e).includes(want));
  if (hits.length === 0) return null;
  const sameStore = hits.filter((e) => e.store_id === storeId);
  if (sameStore.length === 1) return sameStore[0]!;
  if (hits.length === 1) return hits[0]!;
  return null;
}

export type CashLinkResult =
  | { linked: true; entry_id: string; employee_name: string; period: string }
  | { linked: false; reason: "not_payroll" | "already" | "no_person" | "no_period" | "period_closed" | "no_line" };

/**
 * Bir kasa ödemesini bordroya bağlar. Zaten bağlıysa, kişi bulunamadıysa ya da
 * dönem yoksa/kapalıysa sessizce geçer — çağıran yere nedeni döner.
 */
export async function linkCashAdvanceToPayroll(
  prisma: PrismaClient,
  opts: { cash_advance_id: string; employee_id?: string | null; user_id: string; user_name: string }
): Promise<CashLinkResult> {
  const adv = await prisma.cashAdvance.findUnique({
    where: { id: opts.cash_advance_id },
    include: { daily_record: { select: { date: true, store_id: true, store: { select: { name: true } } } } },
  });
  if (!adv || !isPayrollCashCategory(adv.category)) return { linked: false, reason: "not_payroll" };

  const existing = await prisma.payrollEntry.findUnique({ where: { cash_advance_id: adv.id }, select: { id: true } });
  if (existing) return { linked: false, reason: "already" };

  let employeeId = opts.employee_id ?? null;
  if (!employeeId) {
    if (!adv.staff_name) return { linked: false, reason: "no_person" };
    const all = await prisma.payrollEmployee.findMany({
      where: { deleted_at: null },
      select: { id: true, store_id: true, full_name: true, aliases: true, bank_account_name: true },
    });
    employeeId = matchEmployeeByName(adv.staff_name, adv.daily_record.store_id, all)?.id ?? null;
    if (!employeeId) return { linked: false, reason: "no_person" };
  }

  const date = adv.daily_record.date;
  const period = await prisma.payrollPeriod.findUnique({
    where: { year_month: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } },
  });
  if (!period) return { linked: false, reason: "no_period" };
  if (period.status === "closed") return { linked: false, reason: "period_closed" };

  const line = await prisma.payrollLine.findUnique({
    where: { period_id_employee_id: { period_id: period.id, employee_id: employeeId } },
    include: { employee: { select: { full_name: true } } },
  });
  if (!line) return { linked: false, reason: "no_line" };

  const shape = cashEntryShape({
    category: adv.category,
    storeName: adv.daily_record.store.name,
    description: adv.description,
  });
  const entry = await prisma.payrollEntry.create({
    data: {
      line_id: line.id,
      period_id: period.id,
      employee_id: employeeId,
      kind: shape.kind,
      category: shape.category,
      channel: "cash",
      entry_date: date,
      amount: adv.amount_try,
      note: shape.note,
      reference: shape.reference,
      cash_advance_id: adv.id,
      created_by: opts.user_id,
      created_by_name: opts.user_name,
    },
  });
  return {
    linked: true,
    entry_id: entry.id,
    employee_name: line.employee.full_name,
    period: `${String(period.month).padStart(2, "0")}.${period.year}`,
  };
}

/**
 * Dönem açılınca / satırlar tamamlanınca: o ayın bağlanmamış kasa ödemelerini
 * bordroya işler. Mağaza ödemeyi dönem açılmadan girmişse kayıp olmaz.
 */
export async function syncCashAdvancesForPeriod(
  prisma: PrismaClient,
  periodId: string,
  user: { id: string; name: string }
): Promise<number> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.status === "closed") return 0;
  const from = new Date(Date.UTC(period.year, period.month - 1, 1));
  const to = new Date(Date.UTC(period.year, period.month, 1));
  const candidates = await prisma.cashAdvance.findMany({
    where: {
      category: { in: [...PAYROLL_CASH_CATEGORIES] },
      staff_name: { not: null },
      daily_record: { date: { gte: from, lt: to } },
    },
    select: { id: true },
    orderBy: { created_at: "asc" },
  });
  if (candidates.length === 0) return 0;
  const linked = new Set(
    (
      await prisma.payrollEntry.findMany({
        where: { cash_advance_id: { in: candidates.map((c) => c.id) } },
        select: { cash_advance_id: true },
      })
    ).map((e) => e.cash_advance_id)
  );
  let n = 0;
  for (const c of candidates) {
    if (linked.has(c.id)) continue;
    const r = await linkCashAdvanceToPayroll(prisma, {
      cash_advance_id: c.id,
      user_id: user.id,
      user_name: user.name,
    });
    if (r.linked) n++;
  }
  return n;
}

/**
 * Kasa ödemesi siliniyor: bordrodaki karşılığı da gitmeli. Ödeme bir talimata
 * (banka dosyası / nakit listesi) girdiyse silinmez — önce o grup çözülmeli.
 */
export async function unlinkCashAdvanceFromPayroll(
  prisma: PrismaClient,
  cashAdvanceId: string
): Promise<{ removed: boolean; blocked?: string }> {
  const entry = await prisma.payrollEntry.findUnique({
    where: { cash_advance_id: cashAdvanceId },
    include: { employee: { select: { full_name: true } } },
  });
  if (!entry) return { removed: false };
  if (entry.batch_id) {
    return {
      removed: false,
      blocked:
        `Bu ödeme ${entry.employee.full_name} adına bordroya işlendi ve bir ödeme talimatına girdi. ` +
        "Silmek için önce Maaşlar'dan o talimatı iptal edin.",
    };
  }
  await prisma.payrollEntry.delete({ where: { id: entry.id } });
  return { removed: true };
}
