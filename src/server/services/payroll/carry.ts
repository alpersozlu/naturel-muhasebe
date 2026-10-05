import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { loadPeriodView, nextPeriodKey } from "./period";
import { CARRY_FORWARD_CATEGORY, DEDUCTION_CATEGORIES, periodLabel } from "./rules";

/**
 * SONRAKİ AYA DEVRET (rules.ts → CARRY_FORWARD_CATEGORY).
 *
 * Bir satırın Net Kalan'ı eksideyse (kesinti o ayın ekstrasını aştı, ya da
 * fazla ödeme yapıldı) eksi tutarın tamamı sonraki ayın maaşına taşınır:
 *
 *   bu ay       + tutar   addition / carry_forward   → Net Kalan 0, ay kapanabilir
 *   sonraki ay  − tutar   deduction / carry_over     → o ayın Ödeme 1'inden düşer
 *
 * İki kayıt aynı carry_id'yi taşır. Çağıran taraf bunu bir veritabanı işlemi
 * (transaction) içinde çalıştırır; sonraki dönem ÖNCEDEN var olmalıdır
 * (payroll router: yoksa ensurePeriod ile açar).
 */
type Db = PrismaClient | Prisma.TransactionClient;

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type CarryResult = {
  id: string; // bu aydaki kaydın kimliği
  carry_id: string;
  amount: number;
  from_label: string;
  to_label: string;
  to_period_id: string;
};

export async function carryForwardCore(db: Db, lineId: string, actor: { id: string; name: string }): Promise<CarryResult> {
  const line = await db.payrollLine.findUnique({
    where: { id: lineId },
    include: { period: true, employee: { select: { full_name: true } } },
  });
  if (!line) throw new TRPCError({ code: "NOT_FOUND" });
  if (line.period.status === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "Kapalı ay — önce dönemi yeniden aç." });

  const view = await loadPeriodView(db as PrismaClient, line.period_id);
  const computed = view?.stores.flatMap((s) => s.lines).find((l) => l.id === lineId);
  if (!computed) throw new TRPCError({ code: "NOT_FOUND" });
  const net = computed.calc.net_remaining;
  if (net > -0.5) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Devredilecek eksi bakiye yok — Net Kalan sıfır ya da artıda." });
  }
  const amount = round2(-net);

  const nk = nextPeriodKey(line.period.year, line.period.month);
  const fromLabel = periodLabel(line.period.year, line.period.month);
  const toLabel = periodLabel(nk.year, nk.month);
  const next = await db.payrollPeriod.findUnique({ where: { year_month: { year: nk.year, month: nk.month } } });
  if (!next) throw new TRPCError({ code: "BAD_REQUEST", message: `${toLabel} dönemi henüz açılmadı.` });
  if (next.status === "closed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${toLabel} kapalı — devredilemez. Önce o ayı yeniden açın.` });
  }
  const nextLine = await db.payrollLine.findUnique({
    where: { period_id_employee_id: { period_id: next.id, employee_id: line.employee_id } },
  });
  if (!nextLine) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${line.employee.full_name} için ${toLabel} bordrosunda satır yok (ayrılmış olabilir) — devredilemez. Tutarı çıkış mutabakatında kapatın.`,
    });
  }

  // Devrin kaynağı: bu ayın kesintileri (kategori bazında); kesinti yoksa fazla ödemedir.
  const byCat = new Map<string, number>();
  for (const e of computed.calc.entries) {
    if (e.kind !== "deduction" || !e.counted) continue;
    const label = DEDUCTION_CATEGORIES[(e.category ?? "other") as keyof typeof DEDUCTION_CATEGORIES] ?? "Kesinti";
    byCat.set(label, (byCat.get(label) ?? 0) + e.amount);
  }
  const reason = byCat.size
    ? Array.from(byCat.entries())
        .map(([label, v]) => `${label} ${TRY.format(v)}`)
        .join(", ")
    : "fazla ödeme";

  const carry_id = randomUUID();
  const common = { employee_id: line.employee_id, amount, carry_id, created_by: actor.id, created_by_name: actor.name };
  const out = await db.payrollEntry.create({
    data: {
      ...common,
      line_id: line.id,
      period_id: line.period_id,
      kind: "addition",
      category: CARRY_FORWARD_CATEGORY,
      entry_date: new Date(Date.UTC(line.period.year, line.period.month, 0)), // ayın son günü
      note: `${toLabel} maaşına devredildi — bu ay kesilemeyen ${TRY.format(amount)} ₺. Kaynak: ${reason}.`,
    },
  });
  await db.payrollEntry.create({
    data: {
      ...common,
      line_id: nextLine.id,
      period_id: next.id,
      kind: "deduction",
      category: "carry_over",
      entry_date: new Date(Date.UTC(nk.year, nk.month - 1, 1)), // ayın ilk günü
      note: `${fromLabel} bordrosundan devir — o ay kesilemeyen ${TRY.format(amount)} ₺. Kaynak: ${reason}.`,
    },
  });
  return { id: out.id, carry_id, amount, from_label: fromLabel, to_label: toLabel, to_period_id: next.id };
}
