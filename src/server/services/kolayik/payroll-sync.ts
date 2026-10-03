import "server-only";
import type { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/server/services/payroll/nebim-revenue";
import { KolayikError, kolayikConfigured, leaveStatus, listLeaves, listOvertime, listPersons, type KPerson } from "./client";

/**
 * Kolay İK → bordro: ayın onaylı mesai kayıtları ve izinleri, bordro
 * personeline isimle eşlenmiş olarak. Yalnız okur; bordroya hiçbir şeyi
 * kendiliğinden yazmaz — mesai saatleri prim ekranında ÖNERİ olarak görünür,
 * "Uygula" ile sahibi işler. (Kolay İK'da hak günü ile yıllık izin aynı
 * türde tutulduğu için izin eşleştirmesi insan onayından geçmelidir.)
 */
export type KolayikMonth = {
  configured: boolean;
  ok: boolean;
  error: string | null;
  /** Bölüm bazlı sorunlar — bağlantı var ama bir liste okunamadı */
  warnings: string[];
  fetched_at: string;
  persons: number;
  unmatched_persons: string[];
  unmatched_employees: string[];
  overtime: Array<{
    employee_id: string | null;
    line_id: string | null;
    person_name: string;
    approved_hours: number;
    waiting_hours: number;
    other_hours: number;
    note: string;
    entries: Array<{ date: string; hours: number; status: string; description: string | null }>;
  }>;
  leaves: Array<{
    employee_id: string | null;
    person_name: string;
    days_approved: number;
    entries: Array<{ id: string; type: string; start: string; end: string; days: number; status: string; comment: string | null }>;
  }>;
};

type Emp = { id: string; full_name: string; aliases: string[]; bank_account_name: string | null; status: string };

/** Kolay İK kişisi ↔ bordro personeli: tam ad / takma ad; olmazsa ilk + son ad. */
export function matchEmployee(person: { name: string }, employees: Emp[]): Emp | null {
  const key = normalizeName(person.name);
  for (const e of employees) {
    const cands = [e.full_name, e.bank_account_name, ...e.aliases].filter(Boolean) as string[];
    if (cands.some((c) => normalizeName(c) === key)) return e;
  }
  const t = key.split(" ").filter(Boolean);
  if (t.length < 2) return null;
  const hits = employees.filter((e) => {
    const et = normalizeName(e.full_name).split(" ").filter(Boolean);
    return et.length >= 2 && et[0] === t[0] && et[et.length - 1] === t[t.length - 1];
  });
  return hits.length === 1 ? hits[0]! : null;
}

const personName = (p: KPerson) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
const r2 = (v: number) => Math.round(v * 100) / 100;
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

export async function kolayikMonth(prisma: PrismaClient, year: number, month: number): Promise<KolayikMonth> {
  const base: KolayikMonth = {
    configured: kolayikConfigured(),
    ok: false,
    error: null,
    warnings: [],
    fetched_at: new Date().toISOString(),
    persons: 0,
    unmatched_persons: [],
    unmatched_employees: [],
    overtime: [],
    leaves: [],
  };
  if (!base.configured) return { ...base, error: "Kolay İK anahtarı tanımlı değil (KOLAYIK_API_TOKEN)." };

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  try {
    // Bir liste hata verse de diğerleri görünsün — her bölüm ayrı raporlanır.
    const [pRes, oRes, lRes] = await Promise.allSettled([listPersons("active"), listOvertime(from, to), listLeaves(from, to)]);
    if (pRes.status === "rejected") throw pRes.reason;
    const persons = pRes.value;
    const errText = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));
    const overtime = oRes.status === "fulfilled" ? oRes.value : [];
    const leaves = lRes.status === "fulfilled" ? lRes.value : [];
    if (oRes.status === "rejected") base.warnings.push(`Mesai kayıtları okunamadı — ${errText(oRes)}`);
    if (lRes.status === "rejected") base.warnings.push(`İzin kayıtları okunamadı — ${errText(lRes)}`);
    const employees: Emp[] = await prisma.payrollEmployee.findMany({
      where: { deleted_at: null },
      select: { id: true, full_name: true, aliases: true, bank_account_name: true, status: true },
    });
    const period = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
    const lines = period
      ? await prisma.payrollLine.findMany({ where: { period_id: period.id }, select: { id: true, employee_id: true } })
      : [];
    const lineOf = new Map(lines.map((l) => [l.employee_id, l.id]));

    const nameById = new Map(persons.map((p) => [p.id, personName(p)]));
    const empByPerson = new Map<string, Emp | null>();
    const empFor = (personId: string, name: string) => {
      if (!empByPerson.has(personId)) empByPerson.set(personId, matchEmployee({ name }, employees));
      return empByPerson.get(personId) ?? null;
    };
    for (const p of persons) empFor(p.id, personName(p));

    base.persons = persons.length;
    base.unmatched_persons = persons.filter((p) => !empByPerson.get(p.id)).map(personName);
    const matchedIds = new Set(Array.from(empByPerson.values()).filter(Boolean).map((e) => e!.id));
    base.unmatched_employees = employees.filter((e) => e.status === "active" && !matchedIds.has(e.id)).map((e) => e.full_name);

    // Mesai
    const ot = new Map<string, KolayikMonth["overtime"][number]>();
    for (const t of overtime) {
      const name = nameById.get(t.personId) ?? `kişi ${t.personId.slice(0, 6)}`;
      const emp = empFor(t.personId, name);
      const row =
        ot.get(t.personId) ??
        ({
          employee_id: emp?.id ?? null,
          line_id: emp ? (lineOf.get(emp.id) ?? null) : null,
          person_name: name,
          approved_hours: 0,
          waiting_hours: 0,
          other_hours: 0,
          note: "",
          entries: [],
        } satisfies KolayikMonth["overtime"][number]);
      const hours = r2((t.usedMinute ?? 0) / 60);
      if (t.status === "approved") row.approved_hours = r2(row.approved_hours + hours);
      else if (t.status === "waiting") row.waiting_hours = r2(row.waiting_hours + hours);
      else row.other_hours = r2(row.other_hours + hours);
      row.entries.push({ date: t.startDate.slice(0, 10), hours, status: t.status, description: t.description ?? null });
      ot.set(t.personId, row);
    }
    for (const row of Array.from(ot.values())) {
      const approved = row.entries.filter((e) => e.status === "approved");
      row.note = approved.length
        ? `Kolay İK onaylı mesai: ${approved.map((e) => `${dm(e.date)} ${e.hours}s`).join(", ")} = ${row.approved_hours} saat`
        : "";
    }
    base.overtime = Array.from(ot.values()).sort((a, b) => a.person_name.localeCompare(b.person_name, "tr"));

    // İzinler
    const lv = new Map<string, KolayikMonth["leaves"][number]>();
    for (const l of leaves) {
      const pid = l.person?.id ?? "?";
      const name = l.person?.name ?? nameById.get(pid) ?? "—";
      const emp = pid !== "?" ? empFor(pid, name) : null;
      const row = lv.get(pid) ?? { employee_id: emp?.id ?? null, person_name: name, days_approved: 0, entries: [] };
      const days = Number(l.usedDays ?? 0);
      if (l.status === "approved") row.days_approved = r2(row.days_approved + days);
      row.entries.push({
        id: l.id,
        type: l.type?.name ?? "—",
        start: l.startDate.slice(0, 10),
        end: l.endDate.slice(0, 10),
        days,
        status: l.status,
        comment: l.comment ?? null,
      });
      lv.set(pid, row);
    }
    base.leaves = Array.from(lv.values()).sort((a, b) => a.person_name.localeCompare(b.person_name, "tr"));
    base.ok = true;
    return base;
  } catch (e) {
    return { ...base, error: e instanceof KolayikError ? e.message : `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Bir bordro personelinin Kolay İK izin bakiyeleri (tür bazında). */
export async function kolayikLeaveStatus(prisma: PrismaClient, employeeId: string) {
  if (!kolayikConfigured()) return { ok: false as const, error: "Kolay İK anahtarı tanımlı değil.", rows: [] };
  try {
    const e = await prisma.payrollEmployee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { id: true, full_name: true, aliases: true, bank_account_name: true, status: true },
    });
    const persons = [...(await listPersons("active")), ...(e.status === "left" ? await listPersons("inactive") : [])];
    const person = persons.find((p) => matchEmployee({ name: personName(p) }, [e]));
    if (!person) return { ok: false as const, error: `${e.full_name} Kolay İK'da bulunamadı — takma ad ekleyin.`, rows: [] };
    const rows = await leaveStatus(person.id);
    return {
      ok: true as const,
      error: null,
      rows: rows
        .filter((r) => r.active !== false)
        .map((r) => ({
          name: r.name,
          primary: !!r.primary,
          total: r.total ?? null,
          used: r.used ?? r.currentUsed ?? null,
          unused: r.unused ?? null,
          current_earned: r.currentEarned ?? null,
          carried_over: r.carriedOver ?? null,
        })),
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e), rows: [] };
  }
}
