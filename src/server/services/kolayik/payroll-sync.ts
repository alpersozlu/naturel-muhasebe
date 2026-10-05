import "server-only";
import type { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/server/services/payroll/nebim-revenue";
import { KolayikError, kolayikConfigured, leaveDaysWithin, leaveStatus, listLeaves, listOvertime, listPersons, pooled, type KPerson } from "./client";
import {
  buildSundayAudit,
  isHolidayNote,
  splitOvertime,
  type AuditLeave,
  type AuditOvertime,
  type OrphanRest,
  type PersonAudit,
  type SundayRow,
} from "./sunday-audit";

/**
 * Kolay İK → bordro: ayın onaylı mesai kayıtları ve izinleri, bordro
 * personeline isimle eşlenmiş olarak. Yalnız okur; bordroya hiçbir şeyi
 * kendiliğinden yazmaz — mesai saatleri prim ekranında ÖNERİ olarak görünür,
 * "Uygula" ile sahibi işler. (Kolay İK'da hak günü ile yıllık izin aynı
 * türde tutulduğu için izin eşleştirmesi insan onayından geçmelidir.)
 *
 * ÖDENECEK MESAİ ≠ GİRİLEN MESAİ (05.10.2026). Pazar (ve resmî tatil) çalışması
 * Kolay İK'ya 8 saatlik mesai olarak girilir; bu 8 saat ÜCRET değil HAK
 * GÜNÜDÜR (sahibi: "pazar çalışana 8 saat yani 1 gün izin veriyoruz"). Yalnız
 * üstü ödenir: "Molasız pazar mesaisi" 600 dk = 1 hak günü + 2 saat ücret.
 * Mert'in Ağustos bordrosu da böyleydi (Yaşar: iki pazar × "1 saat x 2" =
 * 4 saat). approved_hours / waiting_hours ÖDENECEK saattir; girilen ham toplam
 * raw_hours, hak günü sayısı credit_days alanındadır.
 *
 * PAZAR 8 SAAT ÜSTÜ (sahibi, 05.10.2026): "pazar günü 8 saatten fazla yapan ek
 * mesai olarak ödenir; 10 saat yazarsa 2 saat ek mesai olarak maaşa eklenir."
 * Bazıları 10 yerine yalnız ek saati yazar ("Pazar ek mesai" 2 saat) — o da
 * tamamen ücrettir. Ödenecek saatin pazar / tatile düşen kısmı
 * sunday_extra_hours alanında ayrıca verilir; kalanı diğer günlerin mesaisidir.
 *
 * PAZAR EK SAATİ KAYITTA İKİ KATIDIR (sahibi, 05.10.2026: "pazar x2 sayılır
 * yasal olarak; 1 saat çalıştıysa 2 saat girdi hepsi"). Buradaki saatler
 * yazıldığı gibi alınır ve saatlik ücretle (net baz ÷ 208) bir kez çarpılır —
 * pazar için ikinci bir çarpan UYGULANMAZ, yoksa dört katı ödenir.
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
    /** ÖDENECEK onaylı saat — pazar / tatil kayıtlarının 8 saatlik hak günü kısmı hariç */
    approved_hours: number;
    /** onay bekleyen kayıtların ödenecek kısmı */
    waiting_hours: number;
    other_hours: number;
    /** Kolay İK'ya girilen onaylı ham toplam (hak günleri dahil) */
    raw_hours: number;
    /** Onaylı pazar / tatil kayıtlarından doğan hak günü sayısı */
    credit_days: number;
    /** approved_hours'ın pazar / tatil gününe düşen kısmı: 8 saatin üstü; yalnız ek saat yazılmışsa tamamı */
    sunday_extra_hours: number;
    /** Pazar / tatil günü 8 saatin altında girilmiş kayıt sayısı — yalnız ek mesai yazılmış, 8 saat ayrıca girilmemiş */
    short_sunday_records: number;
    /** Hafta içi 8+ saatlik, tatil notu olmayan kayıt var — elle bakılmalı */
    review: boolean;
    note: string;
    entries: Array<{
      date: string;
      hours: number;
      paid_hours: number;
      credit_day: boolean;
      /** Pazar / resmî tatil gününe ait kayıt */
      rest_day: boolean;
      status: string;
      description: string | null;
    }>;
  }>;
  leaves: Array<{
    employee_id: string | null;
    person_name: string;
    /** Onaylı izinlerin BU AYA düşen gün sayısı (ay sınırını aşan izin kırpılır) */
    days_approved: number;
    entries: Array<{
      id: string;
      type: string;
      start: string;
      end: string;
      /** İznin tamamı (Kolay İK usedDays) */
      days: number;
      /** Bu aya düşen kısmı — önceki ayda başlayan / sonraki aya uzanan izinde `days`ten küçüktür */
      days_in_month: number;
      status: string;
      comment: string | null;
    }>;
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
const hTr = (v: number) => String(v).replace(".", ",");
/** Satırın mesai notu 500 karakterle sınırlı (lineUpdateSchema) — taşan liste kırpılır. */
const clip = (s: string) => (s.length <= 480 ? s : `${s.slice(0, 477)}…`);

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
          raw_hours: 0,
          credit_days: 0,
          sunday_extra_hours: 0,
          short_sunday_records: 0,
          review: false,
          note: "",
          entries: [],
        } satisfies KolayikMonth["overtime"][number]);
      const date = t.startDate.slice(0, 10);
      const minutes = t.usedMinute ?? 0;
      const hours = r2(minutes / 60);
      const split = splitOvertime({ date, minutes, description: t.description ?? null });
      const paid = r2(split.paid_minutes / 60);
      if (t.status === "approved") {
        row.approved_hours = r2(row.approved_hours + paid);
        row.raw_hours = r2(row.raw_hours + hours);
        if (split.credit_day) row.credit_days += 1;
        if (split.rest_day) row.sunday_extra_hours = r2(row.sunday_extra_hours + paid);
      } else if (t.status === "waiting") row.waiting_hours = r2(row.waiting_hours + paid);
      else row.other_hours = r2(row.other_hours + hours);
      if (t.status !== "rejected" && split.rest_day && !split.credit_day) row.short_sunday_records += 1;
      // Hafta içi 8+ saat ve tatil notu yok: hak günü mü, ücret mi — belli değil
      if (t.status !== "rejected" && minutes >= 480 && !split.credit_day && !isHolidayNote(t.description)) row.review = true;
      row.entries.push({
        date,
        hours,
        paid_hours: paid,
        credit_day: split.credit_day,
        rest_day: split.rest_day,
        status: t.status,
        description: t.description ?? null,
      });
      ot.set(t.personId, row);
    }
    for (const row of Array.from(ot.values())) {
      const paidOnes = row.entries.filter((e) => e.status === "approved" && e.paid_hours > 0);
      const other = r2(row.approved_hours - row.sunday_extra_hours);
      const tail = [
        row.sunday_extra_hours > 0
          ? other > 0
            ? `pazar/tatil 8 saat üstü ${hTr(row.sunday_extra_hours)} s + diğer günler ${hTr(other)} s`
            : "tamamı pazar/tatil 8 saat üstü"
          : "",
        row.credit_days ? `${row.credit_days} pazar/tatil × 8 saat hak günüdür, ücrete girmez` : "",
      ].filter(Boolean);
      row.note = paidOnes.length
        ? clip(
            `Kolay İK onaylı mesai: ${paidOnes.map((e) => `${dm(e.date)} ${hTr(e.paid_hours)}s${e.rest_day ? " pazar" : ""}`).join(", ")} = ${hTr(
              row.approved_hours
            )} saat${tail.length ? ` (${tail.join("; ")})` : ""}`
          )
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
      const start = l.startDate.slice(0, 10);
      const end = l.endDate.slice(0, 10);
      const daysInMonth = leaveDaysWithin({ start, end, days }, from, to);
      if (l.status === "approved") row.days_approved = r2(row.days_approved + daysInMonth);
      row.entries.push({
        id: l.id,
        type: l.type?.name ?? "—",
        start,
        end,
        days,
        days_in_month: daysInMonth,
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

// ── Pazar çalışması ↔ hak günü denetimi ─────────────────────────────────────

export type SundayAuditView = {
  configured: boolean;
  ok: boolean;
  error: string | null;
  /** Okuma tamamlandı ama bir bölümü eksik kaldı (ör. bakiye okunamadı) */
  warnings: string[];
  fetched_at: string;
  year: number;
  month: number;
  /** Ayın pazarları (YYYY-MM-DD) */
  sundays: string[];
  today: string;
  totals: { people: number; worked: number; with_8h: number; used: number; waiting: number; pending: number; unused: number };
  rows: Array<{
    person_id: string;
    name: string;
    store_name: string | null;
    /** Bordrodaki durum — Kolay İK'da hâlâ "aktif" görünen ayrılmışlar için */
    employee_status: "active" | "inactive" | "left" | null;
    end_date: string | null;
    sundays: SundayRow[];
    orphan_rests: OrphanRest[];
    issues: string[];
    counts: PersonAudit["counts"];
    /** Kolay İK "Yıllık İzin" bakiyesi: kalan = hak edilen + eklenen (hak günleri) − kullanılan */
    balance: { earned: number; bonus: number; used: number; unused: number } | null;
  }>;
  /** Ay içinde hiç pazar çalışması görünmeyen aktif personel */
  not_worked: string[];
};

/** Mağazaların bulunduğu yerde bugünün tarihi (UTC+3, yaz saati yok). */
function storeToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}
const shiftIso = (isoDay: string, days: number) => new Date(new Date(`${isoDay}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Ayın her pazarı için: kim çalıştı (8 saat mesai girdi mi), karşılığında
 * izin kullandı mı, izin onaylandı mı (bakiyeden düştü mü). Kurallar ve
 * eşleştirme: sunday-audit.ts. Yalnız okur.
 *
 * Pencere ayın 3 hafta öncesinden başlar (ay başındaki izinler önceki ayın
 * pazarına ait olabilir — onlar bu ayın pazarını "kapatmasın") ve ay sonundan
 * 2 hafta sonrasına, en çok bugüne kadar uzanır.
 */
export async function kolayikSundayAudit(prisma: PrismaClient, year: number, month: number): Promise<SundayAuditView> {
  const today = storeToday();
  const mm = String(month).padStart(2, "0");
  const monthStart = `${year}-${mm}-01`;
  const monthEnd = `${year}-${mm}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const base: SundayAuditView = {
    configured: kolayikConfigured(),
    ok: false,
    error: null,
    warnings: [],
    fetched_at: new Date().toISOString(),
    year,
    month,
    sundays: [],
    today,
    totals: { people: 0, worked: 0, with_8h: 0, used: 0, waiting: 0, pending: 0, unused: 0 },
    rows: [],
    not_worked: [],
  };
  if (!base.configured) return { ...base, error: "Kolay İK anahtarı tanımlı değil (KOLAYIK_API_TOKEN)." };
  if (monthStart > today) return { ...base, ok: true };

  const from = shiftIso(monthStart, -21);
  const to = shiftIso(monthEnd, 14); // ileri tarihli onaylı / bekleyen izinler de görünsün
  const warnings: string[] = [];
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  try {
    const [active, inactive, timelogs, leaveList, employees] = await Promise.all([
      listPersons("active"),
      listPersons("inactive").catch((e) => {
        warnings.push(`Ayrılmış personel listesi okunamadı — ay içinde ayrılanların pazarları eksik olabilir (${why(e)})`);
        return [] as KPerson[];
      }),
      listOvertime(from, to < today ? to : today),
      // Pencere zaten ayın 3 hafta öncesinden başlar; daha geriden başlayan izin denetimi etkilemez.
      listLeaves(from, to, { lookbackDays: 0 }),
      prisma.payrollEmployee.findMany({
        where: { deleted_at: null },
        select: { id: true, full_name: true, aliases: true, bank_account_name: true, status: true, end_date: true, store: { select: { name: true } } },
      }),
    ]);
    const nameOf = new Map([...inactive, ...active].map((p) => [p.id, personName(p)]));
    const overtime: AuditOvertime[] = timelogs.map((t) => ({
      id: t.id,
      personId: t.personId,
      date: t.startDate.slice(0, 10),
      minutes: t.usedMinute ?? 0,
      status: t.status,
      description: t.description ?? null,
      createdAt: (t.createdAt ?? t.startDate).slice(0, 10),
    }));
    const leaves: AuditLeave[] = leaveList
      .filter((l) => l.person?.id)
      .map((l) => ({
        id: l.id,
        personId: l.person!.id,
        start: l.startDate.slice(0, 10),
        end: l.endDate.slice(0, 10),
        days: Number(l.usedDays ?? 0),
        status: l.status,
        type: l.type?.name ?? "",
        comment: l.comment ?? null,
      }));
    // Aktifler + ay içinde pazar kaydı olan pasifler (ay ortasında ayrılanlar)
    const ids = new Set(active.map((p) => p.id));
    for (const o of overtime) if (o.date >= monthStart && o.date <= monthEnd && nameOf.has(o.personId)) ids.add(o.personId);
    const audit = buildSundayAudit({ year, month, today, personIds: Array.from(ids), overtime, leaves });

    const involved = audit.people.filter((p) => p.counts.worked > 0 || p.issues.length > 0);
    let balanceFails = 0;
    const balances = await pooled(
      involved.map((p) => () =>
        leaveStatus(p.person_id).catch(() => {
          balanceFails += 1;
          return [];
        })
      ),
      5
    );
    if (balanceFails) warnings.push(`${balanceFails} kişinin izin bakiyesi okunamadı — “Yenile” ile yeniden deneyin.`);
    const rows: SundayAuditView["rows"] = involved.map((p, i) => {
      const name = nameOf.get(p.person_id) ?? "—";
      const emp = matchEmployee({ name }, employees);
      const bal = balances[i]!.find((b) => b.primary) ?? balances[i]!.find((b) => /y[ıi]ll[ıi]k/i.test(b.name ?? ""));
      return {
        person_id: p.person_id,
        name,
        store_name: emp ? (employees.find((e) => e.id === emp.id)?.store.name ?? null) : null,
        employee_status: (emp?.status as "active" | "inactive" | "left" | undefined) ?? null,
        end_date: emp ? (employees.find((e) => e.id === emp.id)?.end_date?.toISOString().slice(0, 10) ?? null) : null,
        sundays: p.sundays,
        orphan_rests: p.orphan_rests,
        issues: p.issues,
        counts: p.counts,
        balance: bal
          ? { earned: bal.currentEarned ?? 0, bonus: bal.leaveBonus ?? 0, used: bal.currentUsed ?? bal.used ?? 0, unused: bal.unused ?? 0 }
          : null,
      };
    });
    rows.sort((a, b) => (a.store_name ?? "~").localeCompare(b.store_name ?? "~", "tr") || a.name.localeCompare(b.name, "tr"));
    return {
      ...base,
      ok: true,
      warnings,
      sundays: audit.sundays,
      totals: audit.totals,
      rows,
      not_worked: audit.people
        .filter((p) => p.counts.worked === 0 && p.issues.length === 0)
        .map((p) => nameOf.get(p.person_id) ?? "—")
        .sort((a, b) => a.localeCompare(b, "tr")),
    };
  } catch (e) {
    return { ...base, error: e instanceof KolayikError ? e.message : `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}` };
  }
}
