import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { withAudit, withAuditProtected } from "../middleware/audit";
import { randomBytes } from "node:crypto";
import type { SessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAppBaseForMail } from "@/lib/app-url";
import { explainMailError, isMailConfigured, isMailSandbox, sendMail } from "@/server/services/mail";
import { recordAuthEvent, requestMeta } from "@/server/services/auth-events";
import {
  DATE_KEYS,
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  allowedUpdate,
  canEdit,
  canSee,
  completeness,
  exitPreview,
  profileAlerts,
  tenure,
  type ProfileKey,
  type ProfileValues,
  type Viewer,
} from "@/server/services/hr/profile";
import { checkLeaveRequest, checkOvertimeClaim, checkWorkedDayClaim } from "@/server/services/hr/claims";
import { buildHrSummary, liveLeaveRanges, type HrSummary, type SummaryInput } from "@/server/services/hr/summary";
import { creditDeadline, creditKind } from "@/server/services/hr/credits";
import { buildFeed, type FeedViewer } from "@/server/services/hr/feed";
import { LEAVE_KINDS, OVERTIME_REASONS, OVERTIME_REVIEW_MINUTES, restDayOvertimeAllowed, type LeaveKind } from "@/server/services/hr/rules";

/**
 * NATUREL İK — personel (kendi izni / pazar / mesai), mağaza müdürü (kendi
 * mağazasının onayları) ve sahibi (hepsi). Kurallar services/hr/ altında,
 * burada yalnız yetki + veritabanı. Kolay İK'dan hiçbir şey okunmaz/aktarılmaz.
 *
 * Yetki:
 *   • Personel yalnız kendi kaydına (PayrollEmployee.user_id) talep açar.
 *   • ONAY SIRASI (sahibi, 22.10.2026: "müdürün hesabı mağazasında çalışanlar
 *     için onaylar, ben admin olarak müdürün talebini onaylarım"):
 *       personel → kendi mağazasının müdürü;
 *       müdür (hesabı store_manager) → sahibi;
 *       müdürü olmayan mağazanın personeli → sahibi.
 *     Sahibi gerekirse her talebi onaylayabilir ("hepsini göster").
 *   • Müdür kendi mağazasındakiler adına bildirim girer (anında onaylı).
 */

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dbDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Bugün — Kıbrıs saatiyle. */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia" }).format(now);
}

async function holidaySet(db: Db): Promise<Set<string>> {
  const rows = await db.hrHoliday.findMany({ select: { date: true } });
  return new Set(rows.map((r) => iso(r.date)));
}

/** Bordrosu kapanmış ayların günleri değiştirilemez: son kapalı dönemin ertesi ayının 1'i. */
async function lockedBefore(db: Db): Promise<string | null> {
  const p = await db.payrollPeriod.findFirst({ where: { status: "closed" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!p) return null;
  const y = p.month === 12 ? p.year + 1 : p.year;
  const m = p.month === 12 ? 1 : p.month + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Müdürü / sahibi olduğu mağazalar. */
async function managedStoreIds(db: Db, user: SessionUser): Promise<string[]> {
  if (user.role === "admin") return (await db.store.findMany({ where: { deleted_at: null }, select: { id: true } })).map((s) => s.id);
  if (user.role !== "store_manager") return [];
  const rows = await db.userStoreAccess.findMany({ where: { user_id: user.id, store: { deleted_at: null } }, select: { store_id: true } });
  return rows.map((r) => r.store_id);
}

/** Mağaza müdürünün kaydı = giriş hesabı store_manager olan personel. */
const MANAGER_EMP: Prisma.PayrollEmployeeWhereInput = { user: { role: "store_manager" } };

/**
 * Bu kullanıcının karar vereceği talepler hangi personelin? (onay sırası)
 * `all` yalnız sahibi için: müdürde bekleyenler de gelir.
 */
async function approvalScope(db: Db, user: SessionUser, all = false): Promise<Prisma.PayrollEmployeeWhereInput | null> {
  const managed = await managedStoreIds(db, user);
  if (!managed.length) return null;
  const base: Prisma.PayrollEmployeeWhereInput = { deleted_at: null, store_id: { in: managed } };
  if (user.role !== "admin") return { ...base, NOT: [{ user_id: user.id }, MANAGER_EMP] };
  if (all) return base;
  const withManager = await db.userStoreAccess.findMany({
    where: { user: { role: "store_manager", is_active: true, deleted_at: null } },
    select: { store_id: true },
  });
  const covered = Array.from(new Set(withManager.map((w) => w.store_id)));
  return { ...base, OR: [MANAGER_EMP, { store_id: { notIn: covered } }] };
}

const employeeSelect = {
  id: true,
  full_name: true,
  store_id: true,
  user_id: true,
  start_date: true,
  end_date: true,
  position: true,
  user: { select: { role: true } },
  store: { select: { name: true, brand: { select: { name: true } } } },
} satisfies Prisma.PayrollEmployeeSelect;
type Emp = Prisma.PayrollEmployeeGetPayload<{ select: typeof employeeSelect }>;

async function loadEmployee(db: Db, id: string): Promise<Emp> {
  const e = await db.payrollEmployee.findFirst({ where: { id, deleted_at: null }, select: employeeSelect });
  if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Personel bulunamadı" });
  return e;
}

/**
 * Kimin adına işlem yapılıyor: `employeeId` yoksa kişinin kendisi. Müdür
 * yalnız kendi mağazasındakiler adına girebilir.
 */
async function resolveActor(db: Db, user: SessionUser, employeeId?: string) {
  const own = await db.payrollEmployee.findFirst({ where: { user_id: user.id, deleted_at: null }, select: employeeSelect });
  if (!employeeId || employeeId === own?.id) {
    if (!own) throw new TRPCError({ code: "FORBIDDEN", message: "Hesabınız bir personel kaydına bağlı değil. Yöneticinize söyleyin." });
    return { employee: own, onBehalf: false };
  }
  const target = await loadEmployee(db, employeeId);
  const managed = await managedStoreIds(db, user);
  if (!managed.includes(target.store_id)) throw new TRPCError({ code: "FORBIDDEN", message: "Bu personel sizin mağazanızda değil" });
  return { employee: target, onBehalf: true };
}

/** Kişi özetinin girdileri — bu yıl ve geçen yılın son ayı (Aralık pazarları Ocak'ta kullanılabilir). */
async function summaryInputs(db: Db, emps: Emp[], today: string, holidays: Set<string>) {
  const ids = emps.map((e) => e.id);
  const year = Number(today.slice(0, 4));
  const from = dbDate(`${year - 1}-12-01`);
  const [worked, leaves, overtimes, openings] = await Promise.all([
    db.hrWorkedDay.findMany({ where: { employee_id: { in: ids }, date: { gte: from } }, orderBy: { date: "asc" } }),
    db.hrLeaveRequest.findMany({ where: { employee_id: { in: ids }, end_date: { gte: from } }, orderBy: { start_date: "asc" } }),
    db.hrOvertime.findMany({ where: { employee_id: { in: ids }, date: { gte: from } }, orderBy: { date: "asc" } }),
    db.hrLeaveOpening.findMany({ where: { employee_id: { in: ids }, year } }),
  ]);
  const by = <T extends { employee_id: string }>(rows: T[], id: string) => rows.filter((r) => r.employee_id === id);
  return new Map(
    emps.map((e): [string, { input: SummaryInput; worked: typeof worked; leaves: typeof leaves; overtimes: typeof overtimes }] => {
      const w = by(worked, e.id);
      const l = by(leaves, e.id);
      const o = by(overtimes, e.id);
      const opening = by(openings, e.id)[0];
      return [
        e.id,
        {
          worked: w,
          leaves: l,
          overtimes: o,
          input: {
            employeeId: e.id,
            hireDate: e.start_date ? iso(e.start_date) : null,
            endDate: e.end_date ? iso(e.end_date) : null,
            today,
            holidays,
            opening: opening ? Number(opening.days) : 0,
            workedDays: w.map((x) => ({ id: x.id, date: iso(x.date), status: x.status })),
            leaves: l.map((x) => ({ id: x.id, kind: x.kind, start: iso(x.start_date), end: iso(x.end_date), days: Number(x.days), status: x.status })),
            overtimes: o.map((x) => ({ date: iso(x.date), minutes: x.minutes, status: x.status })),
          },
        },
      ];
    })
  );
}

async function summaryFor(db: Db, emp: Emp, today: string, holidays: Set<string>) {
  const m = await summaryInputs(db, [emp], today, holidays);
  return m.get(emp.id)!;
}

const decisionFields = (user: SessionUser, approved: boolean) =>
  approved ? { status: "approved" as const, decided_by: user.id, decided_at: new Date(), decision_note: "Müdür / yönetici girdi" } : {};

const kindInput = z.enum(["worked", "leave", "overtime"]);

const hrAudited = withAuditProtected("HrRequest");
const hrAdmin = withAudit("HrSettings");

export const hrRouter = router({
  /** Ekranın ilk açılışında her şey: kim, özet, talepler, takvim, müdür mü. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const today = todayIso();
    const [holidays, locked, managed, own] = await Promise.all([
      holidaySet(db),
      lockedBefore(db),
      managedStoreIds(db, user),
      db.payrollEmployee.findFirst({ where: { user_id: user.id, deleted_at: null }, select: employeeSelect }),
    ]);
    let mine: null | { employee: Emp; summary: HrSummary; requests: ReturnType<typeof requestList> } = null;
    if (own) {
      const s = await summaryFor(db, own, today, holidays);
      mine = { employee: own, summary: buildHrSummary(s.input), requests: requestList(s) };
    }
    let pending = 0;
    const scope = await approvalScope(db, user);
    if (scope) {
      const where = { status: "waiting" as const, employee: scope };
      const [a, b, c] = await Promise.all([db.hrWorkedDay.count({ where }), db.hrLeaveRequest.count({ where }), db.hrOvertime.count({ where })]);
      pending = a + b + c;
    }
    const year = Number(today.slice(0, 4));
    const holidayRows = await db.hrHoliday.findMany({ where: { date: { gte: dbDate(`${year}-01-01`), lt: dbDate(`${year + 2}-01-01`) } }, orderBy: { date: "asc" } });
    return {
      today,
      lockedBefore: locked,
      role: user.role,
      name: user.full_name ?? user.email,
      isManager: managed.length > 0,
      pending,
      mine,
      holidays: holidayRows.map((h) => ({ id: h.id, date: iso(h.date), name: h.name })),
      leaveKinds: LEAVE_KINDS,
      overtimeReasons: OVERTIME_REASONS,
    };
  }),

  /** "Pazar / bayram çalıştım". Müdür başkası adına girerse anında onaylıdır. */
  claimWorkedDay: hrAudited
    .input(z.object({ date: isoDate, note: z.string().trim().max(300).optional(), employeeId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const user = ctx.user as SessionUser;
      const { employee, onBehalf } = await resolveActor(db, user, input.employeeId);
      const [holidays, locked, existing] = await Promise.all([
        holidaySet(db),
        lockedBefore(db),
        db.hrWorkedDay.findMany({ where: { employee_id: employee.id, status: { in: ["waiting", "approved"] } }, select: { date: true } }),
      ]);
      const r = checkWorkedDayClaim({ date: input.date, today: todayIso(), holidays, alreadyClaimed: new Set(existing.map((e) => iso(e.date))), lockedBefore: locked });
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.error });
      return db.hrWorkedDay.create({
        data: { employee_id: employee.id, date: dbDate(input.date), kind: r.value.kind, note: input.note || null, created_by: user.id, ...decisionFields(user, onBehalf) },
      });
    }),

  requestLeave: hrAudited
    .input(
      z.object({
        kind: z.enum(["annual", "lieu", "sick", "bereavement", "unpaid"]),
        start: isoDate,
        end: isoDate,
        halfDay: z.boolean().optional(),
        note: z.string().trim().max(300).optional(),
        employeeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const user = ctx.user as SessionUser;
      const { employee, onBehalf } = await resolveActor(db, user, input.employeeId);
      const today = todayIso();
      const [holidays, locked] = await Promise.all([holidaySet(db), lockedBefore(db)]);
      const s = await summaryFor(db, employee, today, holidays);
      const sum = buildHrSummary(s.input);
      const r = checkLeaveRequest({
        kind: input.kind,
        start: input.start,
        end: input.end,
        halfDay: input.halfDay,
        holidays,
        lieuAvailable: sum.lieu.available,
        annualRemaining: sum.annual.wholeAvailable,
        otherLeaves: liveLeaveRanges(s.input.leaves),
        lockedBefore: locked,
      });
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.error });
      return db.hrLeaveRequest.create({
        data: {
          employee_id: employee.id,
          kind: r.value.kind,
          start_date: dbDate(input.start),
          end_date: dbDate(input.end),
          half_day: r.value.halfDay,
          days: new Prisma.Decimal(r.value.days),
          note: input.note || null,
          created_by: user.id,
          ...decisionFields(user, onBehalf),
        },
      });
    }),

  claimOvertime: hrAudited
    .input(
      z.object({
        date: isoDate,
        minutes: z.number().int(),
        reason: z.string(),
        note: z.string().trim().max(300).optional(),
        employeeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const user = ctx.user as SessionUser;
      const { employee, onBehalf } = await resolveActor(db, user, input.employeeId);
      const live = { in: ["waiting" as const, "approved" as const] };
      const [holidays, locked, sameDay, worked] = await Promise.all([
        holidaySet(db),
        lockedBefore(db),
        db.hrOvertime.aggregate({ where: { employee_id: employee.id, date: dbDate(input.date), status: live }, _sum: { minutes: true } }),
        db.hrWorkedDay.count({ where: { employee_id: employee.id, date: dbDate(input.date), status: live } }),
      ]);
      const r = checkOvertimeClaim({
        ...input,
        today: todayIso(),
        holidays,
        alreadyMinutes: sameDay._sum.minutes ?? 0,
        lockedBefore: locked,
        restDayAllowed: restDayOvertimeAllowed(employee.store.brand.name),
        workedDayClaimed: worked > 0,
      });
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.error });
      return db.hrOvertime.create({
        data: { employee_id: employee.id, date: dbDate(input.date), minutes: r.value.minutes, reason: r.value.reason, note: r.value.note, created_by: user.id, ...decisionFields(user, onBehalf) },
      });
    }),

  /** Personel kendi BEKLEYEN talebini geri çeker. */
  cancel: hrAudited.input(z.object({ type: kindInput, id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const own = await db.payrollEmployee.findFirst({ where: { user_id: user.id, deleted_at: null }, select: { id: true } });
    const where = { id: input.id, employee_id: own?.id ?? "-", status: "waiting" as const };
    const data = { status: "cancelled" as const };
    const n =
      input.type === "worked"
        ? await db.hrWorkedDay.updateMany({ where, data })
        : input.type === "leave"
          ? await db.hrLeaveRequest.updateMany({ where, data })
          : await db.hrOvertime.updateMany({ where, data });
    if (n.count === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Bu talep artık geri çekilemez (onaylanmış ya da size ait değil)." });
    return { id: input.id };
  }),

  /** Müdürün / sahibinin onay kutusu + izin kullanmamışlar. */
  approvals: protectedProcedure.input(z.object({ all: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const [managed, scope] = await Promise.all([managedStoreIds(db, user), approvalScope(db, user, user.role === "admin" && !!input?.all)]);
    if (!scope) throw new TRPCError({ code: "FORBIDDEN" });
    const today = todayIso();
    const holidays = await holidaySet(db);
    // Ekip tablosu: müdür kendi mağazasını (kendisi hariç), sahibi hepsini görür
    const teamWhere: Prisma.PayrollEmployeeWhereInput = { store_id: { in: managed }, deleted_at: null, status: "active", ...(user.role === "admin" ? {} : { NOT: { user_id: user.id } }) };
    const inc = { employee: { select: employeeSelect } } as const;
    const atManagers = user.role === "admin" && !input?.all ? await countAtManagers(db, user) : 0;
    const [worked, leaves, overtimes, emps] = await Promise.all([
      db.hrWorkedDay.findMany({ where: { status: "waiting", employee: scope }, include: inc, orderBy: { date: "asc" } }),
      db.hrLeaveRequest.findMany({ where: { status: "waiting", employee: scope }, include: inc, orderBy: { start_date: "asc" } }),
      db.hrOvertime.findMany({ where: { status: "waiting", employee: scope }, include: inc, orderBy: { date: "asc" } }),
      db.payrollEmployee.findMany({ where: teamWhere, select: employeeSelect, orderBy: [{ store_id: "asc" }, { sort_order: "asc" }, { full_name: "asc" }] }),
    ]);
    // Talep sahiplerinin özeti — karar ekranında "onaylarsanız ne olur" için
    const ownerIds = Array.from(new Set([...worked, ...leaves, ...overtimes].map((x) => x.employee_id)));
    const [owners, creators, managerAccess, admins] = await Promise.all([
      db.payrollEmployee.findMany({ where: { id: { in: ownerIds } }, select: employeeSelect }),
      db.user.findMany({ where: { id: { in: [...worked, ...leaves, ...overtimes].map((x) => x.created_by) } }, select: { id: true, full_name: true, email: true } }),
      db.userStoreAccess.findMany({
        where: { user: { role: "store_manager", is_active: true, deleted_at: null } },
        select: { store_id: true, user: { select: { full_name: true, email: true } } },
      }),
      db.user.findMany({ where: { role: "admin", is_active: true, deleted_at: null }, select: { full_name: true, email: true } }),
    ]);
    const inputs = await summaryInputs(db, emps, today, holidays);
    const ownerInputs = await summaryInputs(db, owners, today, holidays);
    const nameOf = (u: { full_name: string | null; email: string }) => u.full_name ?? u.email;
    const managersOf = (storeId: string) => managerAccess.filter((a) => a.store_id === storeId).map((a) => nameOf(a.user));
    /** Onay sırası: müdürün ya da müdürsüz mağazanın talebi yöneticiye, diğerleri mağaza müdürüne */
    const approverOf = (e: Emp) => {
      const managers = managersOf(e.store_id);
      return e.user?.role === "store_manager" || managers.length === 0
        ? { role: "Yönetici", names: admins.map(nameOf) }
        : { role: "Mağaza müdürü", names: managers };
    };
    const who = (e: Emp) => ({
      id: e.id,
      name: e.full_name,
      position: e.position,
      store: e.store.name,
      brand: e.store.brand.name,
      manager: e.user?.role === "store_manager",
    });
    const summaries = emps.map((e) => ({ employee: who(e), summary: buildHrSummary(inputs.get(e.id)!.input) }));
    const common = (x: { employee_id: string; employee: Emp; created_by: string; created_at: Date }) => {
      const creator = creators.find((c) => c.id === x.created_by);
      const o = ownerInputs.get(x.employee_id);
      return {
        employee: who(x.employee),
        createdAt: x.created_at,
        /** Başkası (müdür) adına girdiyse onun adı */
        createdBy: creator && x.created_by !== x.employee.user_id ? nameOf(creator) : null,
        approver: approverOf(x.employee),
        summary: o ? buildHrSummary(o.input) : null,
      };
    };
    return {
      today,
      isAdmin: user.role === "admin",
      showingAll: user.role === "admin" && !!input?.all,
      atManagers,
      items: [
        ...worked.map((w) => ({
          ...common(w),
          type: "worked" as const,
          id: w.id,
          date: iso(w.date),
          kind: (creditKind(iso(w.date), holidays) ?? w.kind) as string,
          deadline: creditDeadline(iso(w.date), holidays),
          note: w.note,
        })),
        ...leaves.map((l) => {
          const c = common(l);
          return {
            ...c,
            type: "leave" as const,
            id: l.id,
            kind: l.kind as LeaveKind,
            start: iso(l.start_date),
            end: iso(l.end_date),
            days: Number(l.days),
            halfDay: l.half_day,
            note: l.note,
            // onaylanırsa kalan yıllık izin eksiye düşer mi
            negative: l.kind === "annual" && !!c.summary && c.summary.annual.remaining - Number(l.days) < 0,
          };
        }),
        ...overtimes.map((o) => ({
          ...common(o),
          type: "overtime" as const,
          id: o.id,
          date: iso(o.date),
          minutes: o.minutes,
          reason: o.reason,
          note: o.note,
          long: o.minutes > OVERTIME_REVIEW_MINUTES,
          restDay: !!creditKind(iso(o.date), holidays),
        })),
      ],
      team: summaries,
    };
  }),

  decide: hrAudited
    .input(z.object({ type: kindInput, id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const user = ctx.user as SessionUser;
      const managed = await managedStoreIds(db, user);
      const sel = { status: true, employee: { select: { store_id: true, user_id: true, user: { select: { role: true } } } } } as const;
      const rec =
        input.type === "worked"
          ? await db.hrWorkedDay.findUnique({ where: { id: input.id }, select: sel })
          : input.type === "leave"
            ? await db.hrLeaveRequest.findUnique({ where: { id: input.id }, select: sel })
            : await db.hrOvertime.findUnique({ where: { id: input.id }, select: sel });
      if (!rec) throw new TRPCError({ code: "NOT_FOUND" });
      if (!managed.includes(rec.employee.store_id)) throw new TRPCError({ code: "FORBIDDEN", message: "Bu personel sizin mağazanızda değil" });
      if (user.role !== "admin" && (rec.employee.user_id === user.id || rec.employee.user?.role === "store_manager")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Müdür taleplerini yönetici onaylar." });
      }
      if (rec.status !== "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: "Bu talep zaten karara bağlanmış." });
      if (!input.approve && !input.note) throw new TRPCError({ code: "BAD_REQUEST", message: "Reddederken kısa bir sebep yazın." });
      const data = { status: input.approve ? ("approved" as const) : ("rejected" as const), decided_by: user.id, decided_at: new Date(), decision_note: input.note || null };
      const where = { id: input.id, status: "waiting" as const };
      if (input.type === "worked") await db.hrWorkedDay.updateMany({ where, data });
      else if (input.type === "leave") await db.hrLeaveRequest.updateMany({ where, data });
      else await db.hrOvertime.updateMany({ where, data });
      return { id: input.id, approved: input.approve };
    }),

  /**
   * PERSONEL — mağaza mağaza (Kolay İK'daki tek uzun liste yerine). Sahibi
   * bütün mağazaları, müdür yalnız kendi mağazasını görür. Her kişide bir
   * bakışta: bugün izinde mi, açık hak günü, bekleyen talep.
   */
  people: protectedProcedure.query(async ({ ctx }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const managed = await managedStoreIds(db, user);
    if (!managed.length) throw new TRPCError({ code: "FORBIDDEN" });
    const today = todayIso();
    const [holidays, emps, stores] = await Promise.all([
      holidaySet(db),
      db.payrollEmployee.findMany({
        where: { store_id: { in: managed }, deleted_at: null, status: "active" },
        select: employeeSelect,
        orderBy: [{ sort_order: "asc" }, { full_name: "asc" }],
      }),
      db.store.findMany({ where: { id: { in: managed } }, select: { id: true, name: true, brand: { select: { name: true } } }, orderBy: { name: "asc" } }),
    ]);
    const inputs = await summaryInputs(db, emps, today, holidays);
    const person = (e: Emp) => {
      const x = inputs.get(e.id)!;
      const s = buildHrSummary(x.input);
      const leaveToday = x.leaves.find((l) => l.status === "approved" && iso(l.start_date) <= today && iso(l.end_date) >= today);
      const open = s.lieu.credits.filter((c) => c.state !== "used");
      const pending =
        x.worked.filter((w) => w.status === "waiting").length + x.leaves.filter((l) => l.status === "waiting").length + x.overtimes.filter((o) => o.status === "waiting").length;
      return {
        id: e.id,
        name: e.full_name,
        position: e.position,
        manager: e.user?.role === "store_manager",
        hasAccount: !!e.user_id,
        onLeaveToday: leaveToday ? (leaveToday.kind as LeaveKind) : null,
        annualWhole: s.annual.known ? s.annual.whole : null,
        lieuOpen: open.length,
        lieuTone: open.some((c) => c.tone === "red") ? ("red" as const) : open.some((c) => c.tone === "amber" || c.tone === "yellow") ? ("yellow" as const) : open.length ? ("neutral" as const) : null,
        overtimeMonthMinutes: s.overtimeMonth.approvedMinutes,
        pending,
      };
    };
    return {
      today,
      isAdmin: user.role === "admin",
      stores: stores
        .map((st) => {
          const people = emps.filter((e) => e.store_id === st.id).map(person);
          // Müdür en üstte
          people.sort((a, b) => Number(b.manager) - Number(a.manager));
          return { id: st.id, brand: st.brand.name, store: st.name, people };
        })
        .filter((st) => st.people.length > 0)
        .sort((a, b) => a.brand.localeCompare(b.brand, "tr") || a.store.localeCompare(b.store, "tr")),
    };
  }),

  /**
   * AJANDA (Kolay İK ana sayfasındaki akışın gelişmişi): önümüzdeki 14 gün —
   * izinde olanlar, doğum günü, iş yıldönümü, resmi tatil; müdür ve sahibine
   * ayrıca hak günü son günü, sahibine belge bitişi; bugün mağazada kaç kişi.
   * Personel yalnız kendi mağazasını ve izin türü olmadan görür.
   */
  feed: protectedProcedure.input(z.object({ days: z.number().int().min(1).max(31).optional() }).optional()).query(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const today = todayIso();
    const days = input?.days ?? 14;
    const managed = await managedStoreIds(db, user);
    let viewer: FeedViewer = user.role === "admin" ? "admin" : managed.length ? "manager" : "staff";
    let storeIds = managed;
    if (viewer === "staff") {
      const own = await db.payrollEmployee.findFirst({ where: { user_id: user.id, deleted_at: null }, select: { store_id: true } });
      storeIds = own ? [own.store_id] : [];
      viewer = "staff";
    }
    const end = new Date(dbDate(today).getTime() + (days - 1) * 86_400_000);
    const [emps, leaves, holidayRows, holidays] = await Promise.all([
      db.payrollEmployee.findMany({
        where: { store_id: { in: storeIds }, deleted_at: null, status: "active" },
        select: { ...employeeSelect, hr_profile: { select: { birth_date: true, work_permit_expiry: true, passport_expiry: true } } },
      }),
      db.hrLeaveRequest.findMany({
        where: { status: "approved", employee: { store_id: { in: storeIds } }, end_date: { gte: dbDate(today) }, start_date: { lte: end } },
        select: { employee_id: true, kind: true, start_date: true, end_date: true, half_day: true },
      }),
      db.hrHoliday.findMany({ where: { date: { gte: dbDate(today), lte: end } } }),
      holidaySet(db),
    ]);
    let credits: Array<{ employeeId: string; date: string; deadline: string }> = [];
    if (viewer !== "staff" && emps.length) {
      const inputs = await summaryInputs(db, emps, today, holidays);
      credits = emps.flatMap((e) =>
        buildHrSummary(inputs.get(e.id)!.input)
          .lieu.credits.filter((c) => c.state !== "used")
          .map((c) => ({ employeeId: e.id, date: c.date, deadline: c.deadline }))
      );
    }
    const feed = buildFeed({
      today,
      days,
      viewer,
      people: emps.map((e) => ({
        id: e.id,
        name: e.full_name,
        store: viewer === "admin" || storeIds.length > 1 ? `${e.store.brand.name} ${e.store.name}` : e.store.name,
        storeId: e.store_id,
        hireDate: e.start_date ? iso(e.start_date) : null,
        birthDate: e.hr_profile?.birth_date ? iso(e.hr_profile.birth_date) : null,
        workPermitExpiry: viewer === "admin" && e.hr_profile?.work_permit_expiry ? iso(e.hr_profile.work_permit_expiry) : null,
        passportExpiry: viewer === "admin" && e.hr_profile?.passport_expiry ? iso(e.hr_profile.passport_expiry) : null,
      })),
      leaves: leaves.map((l) => ({ employeeId: l.employee_id, kind: l.kind, start: iso(l.start_date), end: iso(l.end_date), halfDay: l.half_day })),
      holidays: holidayRows.map((h) => ({ date: iso(h.date), name: h.name })),
      credits,
    });
    return { today, viewer, name: (user.full_name ?? user.email).split(" ")[0], ...feed };
  }),

  /** Tek kişinin kartı: bakiyeler + son talepleri (müdür kendi mağazası, sahibi hepsi). */
  person: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const emp = await loadEmployee(db, input.id);
    const managed = await managedStoreIds(db, user);
    if (!managed.includes(emp.store_id)) throw new TRPCError({ code: "FORBIDDEN", message: "Bu personel sizin mağazanızda değil" });
    const today = todayIso();
    const holidays = await holidaySet(db);
    const s = await summaryFor(db, emp, today, holidays);
    return {
      today,
      employee: {
        id: emp.id,
        name: emp.full_name,
        position: emp.position,
        store: emp.store.name,
        brand: emp.store.brand.name,
        hireDate: emp.start_date ? iso(emp.start_date) : null,
        manager: emp.user?.role === "store_manager",
        hasAccount: !!emp.user_id,
      },
      summary: buildHrSummary(s.input),
      requests: requestList(s),
    };
  }),


  // ── Kişi kartı: bilgiler + hesap (Kolay İK'daki kişi sayfasının gelişmişi) ──

  /** Kişi bilgileri — görünürlük kişiye göre (sahibi / müdür / kendisi). */
  profile: protectedProcedure.input(z.object({ id: z.string().uuid().optional() })).query(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const user = ctx.user as SessionUser;
    const { emp, viewer } = await profileAccess(db, user, input.id);
    const today = todayIso();
    const [profile, bank, account] = await Promise.all([
      db.hrProfile.findUnique({ where: { employee_id: emp.id } }),
      db.payrollEmployee.findUnique({ where: { id: emp.id }, select: { iban: true, bank_account_no: true, bank_branch_code: true, bank_account_name: true, pay_method: true } }),
      accountStatus(db, emp),
    ]);
    const values = profileValues(profile);
    const hireDate = emp.start_date ? iso(emp.start_date) : null;
    const hasBank = !!(bank?.iban || bank?.bank_account_no);
    return {
      viewer,
      employee: { id: emp.id, name: emp.full_name, position: emp.position, store: emp.store.name, brand: emp.store.brand.name, hireDate, manager: emp.user?.role === "store_manager" },
      tenure: tenure(hireDate, today),
      sections: PROFILE_SECTIONS.map((sec) => ({
        key: sec.key,
        title: sec.title,
        fields: sec.fields
          .filter((fd) => canSee(fd, viewer))
          .map((fd) => ({ key: fd.key, label: fd.label, type: fd.type, adminOnly: fd.vis === "admin", editable: canEdit(fd, viewer), value: values[fd.key] ?? null })),
      })).filter((sec) => sec.fields.length > 0),
      // Banka: yalnız sahibi ve kişinin kendisi; düzeltme Maaşlar › Personel'de
      bank: viewer === "manager" || !bank ? null : { iban: bank.iban, accountNo: bank.bank_account_no, branch: bank.bank_branch_code, holder: bank.bank_account_name, payMethod: bank.pay_method },
      completeness: viewer === "admin" ? completeness(values, { hireDate, hasBank }) : null,
      alerts: viewer === "manager" ? profileAlerts({ birth_date: values.birth_date }, today) : profileAlerts(values, today),
      account: viewer === "self" ? null : { ...account, invitedAt: profile?.invited_at ?? null, inviteCount: profile?.invite_count ?? 0, lastReminderAt: profile?.last_reminder_at ?? null },
      suggestedEmail: values.personal_email ?? values.work_email ?? null,
    };
  }),

  /** Bilgi düzeltme: sahibi her şeyi, kişi kendi iletişim / adres / acil durum bilgisini. */
  saveProfile: hrAudited
    .input(z.object({ id: z.string().uuid().optional(), values: z.record(z.string(), z.string().max(300).nullable()) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const user = ctx.user as SessionUser;
      const { emp, viewer } = await profileAccess(db, user, input.id);
      const upd = allowedUpdate(input.values as ProfileValues, viewer);
      if (Object.keys(upd).length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Bu bilgileri değiştirme yetkiniz yok." });
      const data: Record<string, string | Date | null> = {};
      for (const [k, v] of Object.entries(upd) as Array<[ProfileKey, string | null]>) {
        if (DATE_KEYS.has(k) && v) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tarihi takvimden seçin." });
          data[k] = dbDate(v);
        } else data[k] = v;
      }
      if (typeof data.personal_email === "string" && !z.string().email().safeParse(data.personal_email).success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "E-posta adresi hatalı görünüyor." });
      }
      await db.hrProfile.upsert({ where: { employee_id: emp.id }, create: { employee_id: emp.id, ...data, updated_by: user.id }, update: { ...data, updated_by: user.id } });
      return { id: emp.id, changed: Object.keys(upd) };
    }),

  /**
   * DAVET: hesap açar, kişiyi bağlar, "şifreni belirle" bağlantısını e-postayla
   * yollar ve WhatsApp için hazır mesaj döner (Resend alan adı doğrulanmadan
   * e-posta yalnız hesap sahibine ulaşır). Geçici şifre YOK — kişi kendi
   * şifresini belirler.
   */
  invite: adminProcedure // denetim kaydı elle: sonuçtaki şifre bağlantısı AuditLog'a yazılmasın
    .input(z.object({ employeeId: z.string().uuid(), email: z.string().trim().toLowerCase().email("Geçerli bir e-posta yazın"), role: z.enum(["staff", "store_manager"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const emp = await loadEmployee(db, input.employeeId);
      if (emp.user_id) throw new TRPCError({ code: "BAD_REQUEST", message: "Bu kişinin zaten hesabı var — “Hatırlatma gönder”i kullanın." });
      let userId: string;
      const existing = await db.user.findUnique({ where: { email: input.email }, include: { hr_employee: { select: { id: true } } } });
      if (existing) {
        if (existing.deleted_at) throw new TRPCError({ code: "CONFLICT", message: "Bu e-posta silinmiş bir hesaba ait." });
        if (existing.hr_employee) throw new TRPCError({ code: "CONFLICT", message: "Bu e-posta başka bir personele bağlı." });
        userId = existing.id; // müdürün zaten hesabı olabilir — yalnız bağlanır
      } else {
        const supabase = createAdminClient();
        const { data, error } = await supabase.auth.admin.createUser({
          email: input.email,
          password: randomBytes(18).toString("base64url"), // kimseye söylenmez; kişi kendi şifresini belirler
          email_confirm: true,
          user_metadata: { full_name: emp.full_name },
        });
        if (error || !data?.user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Hesap açılamadı: ${error?.message ?? "bilinmeyen hata"}` });
        userId = data.user.id;
        await db.user.create({ data: { id: userId, email: input.email, full_name: emp.full_name, role: input.role } });
      }
      if (input.role === "store_manager") {
        await db.userStoreAccess.upsert({
          where: { user_id_store_id: { user_id: userId, store_id: emp.store_id } },
          create: { user_id: userId, store_id: emp.store_id, role: "store_manager" },
          update: {},
        });
      }
      await db.payrollEmployee.update({ where: { id: emp.id }, data: { user_id: userId } });
      const sent = await sendAccessLink(input.email, emp.full_name, "invite");
      await db.hrProfile.upsert({
        where: { employee_id: emp.id },
        create: { employee_id: emp.id, personal_email: input.email, invited_at: new Date(), invite_count: 1, updated_by: ctx.user.id },
        update: { invited_at: new Date(), invite_count: { increment: 1 } },
      });
      await auditAccount(db, ctx.user.id, emp.id, "create", { action: "invite", email: input.email, role: input.role, mailed: sent.mailed });
      return { id: emp.id, ...sent };
    }),

  /** HATIRLATMA: yeni "şifreni belirle" bağlantısı (eskisi 1 saatte geçersiz olur). */
  remind: adminProcedure.input(z.object({ employeeId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const emp = await ctx.prisma.payrollEmployee.findFirst({ where: { id: input.employeeId }, select: { id: true, full_name: true, user: { select: { email: true, is_active: true } } } });
    if (!emp?.user) throw new TRPCError({ code: "BAD_REQUEST", message: "Önce davet gönderin." });
    if (!emp.user.is_active) throw new TRPCError({ code: "BAD_REQUEST", message: "Hesap durdurulmuş — önce yeniden açın." });
    const sent = await sendAccessLink(emp.user.email, emp.full_name, "reminder");
    await ctx.prisma.hrProfile.upsert({ where: { employee_id: emp.id }, create: { employee_id: emp.id, last_reminder_at: new Date() }, update: { last_reminder_at: new Date() } });
    await auditAccount(ctx.prisma, ctx.user.id, emp.id, "update", { action: "reminder", email: emp.user.email, mailed: sent.mailed });
    return { id: emp.id, ...sent };
  }),

  /** HESABI DURDUR / YENİDEN AÇ — giriş kapanır, veriler silinmez. */
  setAccountActive: hrAdmin.input(z.object({ employeeId: z.string().uuid(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
    const emp = await ctx.prisma.payrollEmployee.findFirst({ where: { id: input.employeeId }, select: { id: true, user: { select: { id: true, role: true } } } });
    if (!emp?.user) throw new TRPCError({ code: "BAD_REQUEST", message: "Bu kişinin hesabı yok." });
    if (emp.user.role === "admin") throw new TRPCError({ code: "BAD_REQUEST", message: "Yönetici hesabı buradan durdurulamaz." });
    await setLogin(emp.user.id, input.active);
    await ctx.prisma.user.update({ where: { id: emp.user.id }, data: { is_active: input.active } });
    return { id: emp.id, active: input.active };
  }),

  /** İşten çıkış ön hesabı: kalan yıllık izin + açık hak günleri × net ÷ 26. */
  exitPreview: adminProcedure.input(z.object({ employeeId: z.string().uuid(), endDate: isoDate })).query(async ({ ctx, input }) => {
    const db = ctx.prisma;
    const emp = await loadEmployee(db, input.employeeId);
    const base = await db.payrollEmployee.findUnique({ where: { id: emp.id }, select: { base_salary: true } });
    const holidays = await holidaySet(db);
    const s = await summaryFor(db, emp, input.endDate, holidays);
    const sum = buildHrSummary(s.input);
    return exitPreview({
      hireDate: emp.start_date ? iso(emp.start_date) : null,
      endDate: input.endDate,
      opening: sum.annual.opening,
      annualUsed: sum.annual.used,
      lieuOpen: sum.lieu.balance,
      netSalary: Number(base?.base_salary ?? 0),
    });
  }),

  /** İŞTEN ÇIKAR: ayrılış tarihi + durum "ayrıldı", giriş kapanır. Bordro çıkış mutabakatı Maaşlar'da. */
  terminate: hrAdmin
    .input(z.object({ employeeId: z.string().uuid(), endDate: isoDate, note: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.prisma;
      const emp = await db.payrollEmployee.findFirst({ where: { id: input.employeeId, deleted_at: null }, select: { id: true, notes: true, user: { select: { id: true, role: true } } } });
      if (!emp) throw new TRPCError({ code: "NOT_FOUND" });
      const note = `Ayrıldı ${input.endDate}${input.note ? ` — ${input.note}` : ""}`;
      await db.payrollEmployee.update({
        where: { id: emp.id },
        data: { status: "left", end_date: dbDate(input.endDate), notes: emp.notes ? `${emp.notes}\n${note}` : note },
      });
      if (emp.user && emp.user.role !== "admin") {
        await setLogin(emp.user.id, false);
        await db.user.update({ where: { id: emp.user.id }, data: { is_active: false } });
      }
      return { id: emp.id, endDate: input.endDate };
    }),

  // ── Sahibi ayarları ──────────────────────────────────────────

  saveHoliday: hrAdmin.input(z.object({ date: isoDate, name: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) =>
    ctx.prisma.hrHoliday.upsert({
      where: { date: dbDate(input.date) },
      create: { date: dbDate(input.date), name: input.name, created_by: ctx.user.id },
      update: { name: input.name },
    })
  ),

  deleteHoliday: hrAdmin.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.prisma.hrHoliday.delete({ where: { id: input.id } });
    return { id: input.id };
  }),

  /** Personel ↔ giriş hesabı eşleştirmesi için liste (yalnız sahibi). */
  accounts: adminProcedure.query(async ({ ctx }) => {
    const [emps, users] = await Promise.all([
      ctx.prisma.payrollEmployee.findMany({
        where: { deleted_at: null, status: "active" },
        select: { ...employeeSelect, user: { select: { id: true, email: true, full_name: true } } },
        orderBy: [{ store_id: "asc" }, { sort_order: "asc" }, { full_name: "asc" }],
      }),
      ctx.prisma.user.findMany({
        where: { deleted_at: null, is_active: true, role: { in: ["staff", "store_manager", "admin"] } },
        select: { id: true, email: true, full_name: true, role: true, hr_employee: { select: { id: true } } },
        orderBy: { email: "asc" },
      }),
    ]);
    return {
      employees: emps.map((e) => ({ id: e.id, name: e.full_name, store: e.store.name, brand: e.store.brand.name, hireDate: e.start_date ? iso(e.start_date) : null, user: e.user })),
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.full_name, role: u.role, linkedTo: u.hr_employee?.id ?? null })),
    };
  }),

  linkUser: hrAdmin.input(z.object({ employeeId: z.string().uuid(), userId: z.string().uuid().nullable() })).mutation(async ({ ctx, input }) => {
    if (input.userId) await ctx.prisma.payrollEmployee.updateMany({ where: { user_id: input.userId }, data: { user_id: null } });
    return ctx.prisma.payrollEmployee.update({ where: { id: input.employeeId }, data: { user_id: input.userId }, select: { id: true, user_id: true } });
  }),
});

/** Kişinin son talepleri (en yeniler üstte) — personel ekranındaki liste. */
function requestList(s: Awaited<ReturnType<typeof summaryFor>>) {
  const rows = [
    ...s.worked.map((w) => ({ type: "worked" as const, id: w.id, date: iso(w.date), end: iso(w.date), status: w.status, label: w.kind === "holiday" ? "Bayram çalıştım" : "Pazar çalıştım", detail: "1 hak günü", note: w.decision_note, createdAt: w.created_at })),
    ...s.leaves.map((l) => ({
      type: "leave" as const,
      id: l.id,
      date: iso(l.start_date),
      end: iso(l.end_date),
      status: l.status,
      label: LEAVE_KINDS.find((k) => k.code === l.kind)?.label ?? "İzin",
      detail: `${Number(l.days).toLocaleString("tr-TR")} gün`,
      note: l.decision_note,
      createdAt: l.created_at,
    })),
    ...s.overtimes.map((o) => ({
      type: "overtime" as const,
      id: o.id,
      date: iso(o.date),
      end: iso(o.date),
      status: o.status,
      label: OVERTIME_REASONS.find((r) => r.code === o.reason)?.label ?? "Mesai",
      detail: `${(o.minutes / 60).toLocaleString("tr-TR")} saat mesai`,
      note: o.decision_note,
      createdAt: o.created_at,
    })),
  ];
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
}

/** Sahibi için bilgi: müdürlerin onayında bekleyen talep sayısı. */
async function countAtManagers(db: Db, user: SessionUser): Promise<number> {
  const [all, mine] = await Promise.all([approvalScope(db, user, true), approvalScope(db, user)]);
  if (!all || !mine) return 0;
  const where = { status: "waiting" as const, employee: { AND: [all, { NOT: mine }] } };
  const [a, b, c] = await Promise.all([db.hrWorkedDay.count({ where }), db.hrLeaveRequest.count({ where }), db.hrOvertime.count({ where })]);
  return a + b + c;
}

/** Kişi kartına kim, hangi gözle bakıyor: kendisi / müdürü / sahibi. */
async function profileAccess(db: Db, user: SessionUser, id?: string): Promise<{ emp: Emp; viewer: Viewer }> {
  const own = await db.payrollEmployee.findFirst({ where: { user_id: user.id, deleted_at: null }, select: employeeSelect });
  if (!id || id === own?.id) {
    if (!own) throw new TRPCError({ code: "FORBIDDEN", message: "Hesabınız bir personel kaydına bağlı değil." });
    return { emp: own, viewer: user.role === "admin" ? "admin" : "self" };
  }
  const emp = await loadEmployee(db, id);
  const managed = await managedStoreIds(db, user);
  if (!managed.includes(emp.store_id)) throw new TRPCError({ code: "FORBIDDEN", message: "Bu personel sizin mağazanızda değil" });
  return { emp, viewer: user.role === "admin" ? "admin" : "manager" };
}

function profileValues(p: Record<string, unknown> | null): ProfileValues {
  const out: ProfileValues = {};
  if (!p) return out;
  for (const fd of PROFILE_FIELDS) {
    const v = p[fd.key];
    out[fd.key] = v instanceof Date ? iso(v) : typeof v === "string" ? v : null;
  }
  return out;
}

/** Hesap durumu: yok / davet edildi (hiç girmedi) / kullanıyor / durduruldu. */
async function accountStatus(db: Db, emp: Emp) {
  if (!emp.user_id) return { state: "none" as const, email: null, lastLogin: null, firstLogin: null, role: null };
  const u = await db.user.findUnique({ where: { id: emp.user_id }, select: { email: true, is_active: true, role: true } });
  if (!u) return { state: "none" as const, email: null, lastLogin: null, firstLogin: null, role: null };
  const [last, first] = await Promise.all([
    db.authEvent.findFirst({ where: { email: u.email, kind: "login_ok" }, orderBy: { created_at: "desc" }, select: { created_at: true } }),
    db.authEvent.findFirst({ where: { email: u.email, kind: "login_ok" }, orderBy: { created_at: "asc" }, select: { created_at: true } }),
  ]);
  const state = !u.is_active ? ("suspended" as const) : last ? ("active" as const) : ("invited" as const);
  return { state, email: u.email, lastLogin: last?.created_at ?? null, firstLogin: first?.created_at ?? null, role: u.role };
}

/** Supabase girişini aç / kapat (user.setActive ile aynı yöntem). */
async function setLogin(userId: string, active: boolean) {
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (error && error.status !== 404) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Giriş ayarlanamadı: ${error.message}` });
}

/**
 * "Şifreni belirle" bağlantısı (kendi sıfırlama sayfamız, 1 saat geçerli) —
 * e-postayla yollanır; e-posta gidemezse ya da Resend deneme modundaysa
 * sahibi WhatsApp mesajını kopyalayıp gönderir.
 */
async function sendAccessLink(email: string, name: string, kind: "invite" | "reminder") {
  const base = await resolveAppBaseForMail(requestMeta().host);
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Bağlantı üretilemedi: ${error?.message ?? "bilinmeyen hata"}` });
  const link = `${base}/tr/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const first = name.trim().split(/\s+/)[0] ?? name;
  const whatsapp = [
    `Merhaba ${first}, Naturel İK hesabınız hazır.`,
    "1) Bu bağlantıyı açın ve kendi şifrenizi belirleyin (1 saat geçerli):",
    link,
    `2) Sonra ${base}/tr/ik adresinden e-postanız (${email}) ve şifrenizle girin.`,
    "Telefonunuzda Paylaş › Ana Ekrana Ekle ile uygulama gibi kullanabilirsiniz.",
  ].join("\n");
  let mailed = false;
  let mailNote: string | null = null;
  if (!isMailConfigured()) mailNote = "E-posta ayarlı değil — mesajı WhatsApp'tan gönderin.";
  else {
    try {
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await sendMail({
        to: email,
        subject: kind === "invite" ? "Naturel İK — hesabınız hazır" : "Naturel İK — şifre belirleme hatırlatması",
        text: whatsapp,
        html: `<div style="padding:32px 16px;background:#f6f6f7;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Naturel Ticaret · İK</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#111827">Merhaba ${esc(first)} 👋</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">İzinlerinizi, pazar çalışmalarınızı ve mesailerinizi artık buradan göreceksiniz. Önce kendi şifrenizi belirleyin (bağlantı 1 saat geçerli).</p>
          <p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Şifremi belirle</a></p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">Sonra ${esc(base)}/tr/ik adresinden e-postanız ve şifrenizle girin.</p></div></div>`,
      });
      mailed = true;
      if (isMailSandbox()) mailNote = "E-posta deneme modunda — yalnız sizin adresinize ulaşır. Mesajı WhatsApp'tan da gönderin.";
    } catch (e) {
      mailNote = `E-posta gönderilemedi (${explainMailError(e)}) — mesajı WhatsApp'tan gönderin.`;
    }
  }
  await recordAuthEvent({ email, kind: "recovery_requested", reason: kind === "invite" ? "hr_invite" : "hr_reminder" });
  return { mailed, mailNote, whatsapp, link };
}

/** Davet / hatırlatma denetim kaydı — bağlantının kendisi YAZILMAZ. */
async function auditAccount(db: Db, userId: string, employeeId: string, action: "create" | "update", after: Record<string, unknown>) {
  try {
    await db.auditLog.create({ data: { user_id: userId, action, entity_type: "HrAccount", entity_id: employeeId, after_json: after as Prisma.InputJsonValue } });
  } catch (e) {
    console.error("[audit] HrAccount log failed", e);
  }
}
