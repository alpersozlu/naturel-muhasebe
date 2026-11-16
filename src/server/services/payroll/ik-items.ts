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

/**
 * AVANS ÖN DOLDURMA — Naturel İK'da SAHİBİNİN onayladığı avans talepleri
 * (sahibi, 16.11.2026: "ben onayladıktan sonra otomatik aktarılsın"). Kayıt
 * burada kendiliğinden oluşmaz: tutar avans talimatı / listesi ekranına dolu
 * gelir, parayı veren ve "ödendi" diyen yine sahibidir — İK'nın onayı ödeme
 * yerine geçmez.
 *
 * Bordroda aynı kişide aynı tutarla avans zaten varsa (ödenmiş) listeye
 * girmez; farklı tutarla varsa uyarı olarak o tutar da döner.
 */
export type IkAdvanceRequest = { employee_id: string; amount: number; date: string; note: string | null; recorded_amount: number | null };

export async function ikAdvanceRequests(
  db: PrismaClient,
  year: number,
  month: number
): Promise<{ ok: boolean; error: string | null; by_employee: Record<string, IkAdvanceRequest> }> {
  if (!process.env.IK_URL || !process.env.BRIDGE_SECRET) return { ok: false, error: null, by_employee: {} };
  let advances: NonNullable<Awaited<ReturnType<typeof fetchIkPayrollMonth>>["advances"]>;
  try {
    advances = (await fetchIkPayrollMonth(year, month)).advances ?? [];
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), by_employee: {} };
  }
  if (advances.length === 0) return { ok: true, error: null, by_employee: {} };
  const period = await db.payrollPeriod.findUnique({ where: { year_month: { year, month } }, select: { id: true } });
  const recorded = period
    ? await db.payrollEntry.findMany({
        where: { period_id: period.id, kind: "advance", voided_at: null, OR: [{ batch_id: null }, { batch: { status: { in: ["prepared", "sent"] } } }] },
        select: { employee_id: true, amount: true },
      })
    : [];
  const by_employee: Record<string, IkAdvanceRequest> = {};
  for (const a of advances) {
    const mine = recorded.filter((r) => r.employee_id === a.employeeId).map((r) => Number(r.amount));
    if (mine.some((x) => Math.abs(x - a.amount) < 0.005)) continue; // aynı tutar zaten bordroda
    const cur = by_employee[a.employeeId];
    by_employee[a.employeeId] = cur
      ? { ...cur, amount: Math.round((cur.amount + a.amount) * 100) / 100, date: a.date > cur.date ? a.date : cur.date }
      : { employee_id: a.employeeId, amount: a.amount, date: a.date, note: a.note, recorded_amount: mine.length ? mine.reduce((s, x) => s + x, 0) : null };
  }
  return { ok: true, error: null, by_employee };
}
