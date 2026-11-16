import "server-only";
import type { PrismaClient } from "@prisma/client";
import { ikAdvanceRequests } from "./ik-items";
import { kolayikAdvanceRequests } from "@/server/services/kolayik/payroll-sync";

/**
 * ONAYLI AMA HENÜZ ÖDENMEMİŞ AVANS TALEPLERİ (sahibi, 16.11.2026).
 *
 * İK'da talebin onaylanması ödeme DEĞİLDİR: para ancak banka talimatı
 * gönderilince yatar ve avans o zaman bordroya düşer. Bu liste aradaki
 * boşluğu gösterir — kim ne kadar bekliyor, hangi kanaldan ödenecek.
 *
 * Kaynak önce Naturel İK, yoksa Kolay İK (batches.prepare ile aynı sıra).
 */
export type PendingAdvanceRequest = {
  line_id: string;
  employee_id: string;
  full_name: string;
  store_name: string;
  position: string;
  /** Kişinin maaş kanalı — talimat bu listeye girer. */
  channel: "garanti" | "ziraat" | "cash" | "other";
  amount: number;
  date: string | null;
  /** Bordroda farklı tutarla zaten kayıtlıysa (kısmen ödenmiş) o tutar. */
  recorded: number | null;
  has_bank_details: boolean;
};

export type PendingAdvances = {
  ok: boolean;
  error: string | null;
  source: "naturel_ik" | "kolay_ik" | null;
  rows: PendingAdvanceRequest[];
  total: number;
};

export async function pendingAdvanceRequests(
  prisma: PrismaClient,
  periodId: string
): Promise<PendingAdvances> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { ok: false, error: "Dönem yok", source: null, rows: [], total: 0 };

  const ik = await ikAdvanceRequests(prisma, period.year, period.month);
  const useIk = ik.ok && Object.keys(ik.by_employee).length > 0;
  const src = useIk ? ik : await kolayikAdvanceRequests(prisma, period.year, period.month);
  if (!src.ok) {
    return { ok: false, error: src.error, source: useIk ? "naturel_ik" : "kolay_ik", rows: [], total: 0 };
  }

  const lines = await prisma.payrollLine.findMany({
    where: { period_id: periodId },
    include: { employee: true, store: { select: { name: true } } },
  });

  const rows: PendingAdvanceRequest[] = [];
  for (const l of lines) {
    const req = src.by_employee[l.employee_id];
    if (!req || req.amount <= 0) continue;
    const recorded = req.recorded_amount ?? 0;
    // Talebin tamamı bordroya girdiyse bekleyen bir şey yok.
    if (recorded >= req.amount - 0.005) continue;
    if (l.employee.status === "inactive") continue;
    rows.push({
      line_id: l.id,
      employee_id: l.employee_id,
      full_name: l.employee.full_name,
      store_name: l.store.name,
      position: l.position,
      channel: l.employee.pay_method as PendingAdvanceRequest["channel"],
      amount: req.amount - recorded,
      date: req.date ?? null,
      recorded: recorded > 0 ? recorded : null,
      has_bank_details: !!(l.employee.bank_branch_code && l.employee.bank_account_no),
    });
  }
  rows.sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      a.store_name.localeCompare(b.store_name, "tr") ||
      a.full_name.localeCompare(b.full_name, "tr")
  );
  return {
    ok: true,
    error: null,
    source: useIk ? "naturel_ik" : "kolay_ik",
    rows,
    total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
  };
}
