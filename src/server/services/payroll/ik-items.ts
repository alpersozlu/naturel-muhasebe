import "server-only";
import type { PrismaClient } from "@prisma/client";
import { fetchIkPayrollMonth, type IkPayrollItem } from "@/server/services/ik-bridge";

/**
 * NATUREL İK → MAAŞLAR. İK'da sahibinin verdiği devamsızlık kesintileri ve
 * nakde çevrilen izinler o ayın bordrosuna kalem kalem gelir. Her kalem bir
 * kez aktarılır: oluşan PayrollEntry'nin reference'ı "naturel-ik:<kalem id>".
 *
 * Durumlar:
 *   pending     İK'da geçerli, Maaşlar'a henüz aktarılmamış
 *   transferred aktarılmış (iptal edilmemiş kayıt var)
 *   stale       İK'da GERİ ALINMIŞ ama Maaşlar'daki kayıt duruyor → iptal edilmeli
 * İK'da geri alınmış ve hiç aktarılmamış kalem listelenmez.
 *
 * Nakde çevrilen izni sahibi kendisi öder (İK kuralı) — bu yüzden varsayılan
 * olarak yalnız bilgi; "Maaşla öde" seçilirse ek hak ediş olarak eklenir.
 */

export const IK_REF_PREFIX = "naturel-ik:";
const REASON_TR: Record<string, string> = {
  sick_report: "raporlu hastalık",
  sick: "raporsuz hastalık",
  unexcused: "habersiz gelmedi",
  other: "devamsızlık",
  annual: "yıllık izin",
  lieu: "hak günü",
};

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export type IkItemView = IkPayrollItem & {
  state: "pending" | "transferred" | "stale";
  employeeName: string | null;
  lineId: string | null;
  entryId: string | null;
  entryNote: string;
};

/** Kaleme yazılacak not — bordroda kimin, neyin, hangi günlerin olduğu okunur. */
export function ikEntryNote(it: IkPayrollItem): string {
  const when = it.start === it.end ? dm(it.start) : `${dm(it.start)}–${dm(it.end)}`;
  const base =
    it.type === "absence_deduction"
      ? `Naturel İK devamsızlık kesintisi (${REASON_TR[it.reason] ?? it.reason}) ${when}: ${it.detail}`
      : `Naturel İK izin nakde çevirme ${when}: ${it.detail}`;
  return it.note ? `${base}. Not: ${it.note}` : base;
}

export async function ikPayrollItems(db: PrismaClient, periodId: string): Promise<{ configured: boolean; error: string | null; items: IkItemView[] }> {
  if (!process.env.IK_URL || !process.env.BRIDGE_SECRET) return { configured: false, error: null, items: [] };
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  let raw: IkPayrollItem[];
  try {
    raw = (await fetchIkPayrollMonth(period.year, period.month)).items ?? [];
  } catch (e) {
    return { configured: true, error: e instanceof Error ? e.message : String(e), items: [] };
  }
  const [lines, entries] = await Promise.all([
    db.payrollLine.findMany({ where: { period_id: periodId }, select: { id: true, employee_id: true, employee: { select: { full_name: true } } } }),
    db.payrollEntry.findMany({
      where: { period_id: periodId, reference: { startsWith: IK_REF_PREFIX }, voided_at: null },
      select: { id: true, reference: true },
    }),
  ]);
  const lineOf = new Map(lines.map((l) => [l.employee_id, l]));
  const entryOf = new Map(entries.map((e) => [e.reference!.slice(IK_REF_PREFIX.length), e.id]));
  const items: IkItemView[] = [];
  for (const it of raw) {
    const entryId = entryOf.get(it.id) ?? null;
    if (it.status === "cancelled" && !entryId) continue;
    const line = lineOf.get(it.employeeId);
    items.push({
      ...it,
      state: it.status === "cancelled" ? "stale" : entryId ? "transferred" : "pending",
      employeeName: line?.employee.full_name ?? null,
      lineId: line?.id ?? null,
      entryId,
      entryNote: ikEntryNote(it),
    });
  }
  items.sort((a, b) => (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "tr") || a.start.localeCompare(b.start));
  return { configured: true, error: null, items };
}
