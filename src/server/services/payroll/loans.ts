import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Otomatik taksit — şirket borcu / çalışma izni borcu.
 *
 * Sahibi (02.10.2026): "Çalışma izni borçları olursa sisteme gireyim ve
 * otomatik olarak maaşlarından kesilsin." Borç bir kez girilir
 * (toplam, aylık taksit, başlangıç ayı); her açılan dönemde kişinin
 * satırına taksit kadar kesinti düşer, kalan bitince durur. Bir ayın
 * taksidi iptal edilirse o ay atlanır (yeniden üretilmez).
 */
const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export async function applyLoanInstallments(prisma: PrismaClient, periodId: string): Promise<number> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.status === "closed") return 0;
  const loans = await prisma.payrollLoan.findMany({
    where: { closed_at: null, auto_deduct: true, installment: { gt: 0 } },
    include: { repayments: { select: { amount: true, voided_at: true, period_id: true } } },
  });
  let created = 0;
  for (const loan of loans) {
    if (loan.start_year != null && loan.start_month != null) {
      if (period.year * 100 + period.month < loan.start_year * 100 + loan.start_month) continue;
    }
    // Bu dönemde (iptal edilmiş olsa bile) taksit varsa dokunma — ay atlanmış sayılır.
    if (loan.repayments.some((r) => r.period_id === periodId)) continue;
    const paidEntries = loan.repayments.filter((r) => !r.voided_at);
    const repaid = paidEntries.reduce((s, r) => s + Number(r.amount), 0);
    const principal = Number(loan.principal);
    const remaining = round2(principal - Number(loan.opening_repaid) - repaid);
    if (remaining <= 0.005) continue;
    const line = await prisma.payrollLine.findUnique({
      where: { period_id_employee_id: { period_id: periodId, employee_id: loan.employee_id } },
    });
    if (!line) continue;
    const installment = Number(loan.installment);
    const amount = round2(Math.min(installment, remaining));
    const seq = paidEntries.length + 1;
    const total = Math.max(seq, Math.ceil((principal - Number(loan.opening_repaid)) / installment));
    const label = loan.category === "work_permit" ? "Çalışma izni borcu" : "Şirket borcu";
    await prisma.payrollEntry.create({
      data: {
        line_id: line.id,
        period_id: periodId,
        employee_id: loan.employee_id,
        kind: "deduction",
        category: loan.category === "work_permit" ? "work_permit" : "loan",
        entry_date: new Date(Date.UTC(period.year, period.month, 0)), // ayın son günü
        amount,
        loan_id: loan.id,
        note: `${label} taksidi ${seq}/${total} — toplam ${TRY.format(principal)} ₺, bu taksitten sonra kalan ${TRY.format(
          round2(remaining - amount)
        )} ₺ (otomatik)`,
        created_by_name: "Otomatik taksit",
      },
    });
    created += 1;
  }
  return created;
}

/** Yeni/değişen borç: açık dönemlerin tamamına taksitleri işle (idempotent). */
export async function applyLoanToOpenPeriods(prisma: PrismaClient): Promise<number> {
  const open = await prisma.payrollPeriod.findMany({ where: { status: "open" }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  let n = 0;
  for (const p of open) n += await applyLoanInstallments(prisma, p.id);
  return n;
}
