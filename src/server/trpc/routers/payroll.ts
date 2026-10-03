import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { router, adminProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import {
  batchCreateSchema,
  batchPreviewSchema,
  batchStatusSchema,
  cashAdvanceLinkSchema,
  employeeCreateSchema,
  employeeLeaveSchema,
  employeeUpdateSchema,
  entryCreateSchema,
  entryVoidSchema,
  idSchema,
  importAccountsSchema,
  lineUpdateSchema,
  loanCreateSchema,
  loanUpdateSchema,
  periodIdSchema,
  periodKeySchema,
  storeMonthUpsertSchema,
} from "@/lib/zod-schemas/payroll";
import {
  computeFromLine,
  ensureLines,
  ensurePeriod,
  isoDate,
  lineInclude,
  loadPeriodView,
  nextPeriodKey,
  num,
} from "@/server/services/payroll/period";
import { derimodMonthRevenue, normalizeName, personRevenueFor } from "@/server/services/payroll/nebim-revenue";
import {
  buildCashListXlsx,
  buildGarantiTalimatXlsx,
  parseGarantiTalimat,
  talimatFileName,
} from "@/server/services/payroll/talimat";
import { periodLabel } from "@/server/services/payroll/rules";
import { applyLoanToOpenPeriods } from "@/server/services/payroll/loans";
import { cashVarianceSummary } from "@/server/services/analytics/cash-variance";
import { kolayikLeaveStatus, kolayikMonth } from "@/server/services/kolayik/payroll-sync";

const employeeAudited = withAudit("PayrollEmployee");
const periodAudited = withAudit("PayrollPeriod");
const lineAudited = withAudit("PayrollLine");
const entryAudited = withAudit("PayrollEntry");
const batchAudited = withAudit("PayrollBatch");
const loanAudited = withAudit("PayrollLoan");

const KIND_LABEL: Record<"advance" | "payment1" | "payment2" | "single", string> = {
  advance: "Avans",
  payment1: "Odeme 1 (Kalan Maas)",
  payment2: "Odeme 2 (Mesai-Komisyon-Prim)",
  single: "Tekil",
};

function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function bankName(e: { bank_account_name: string | null; full_name: string }): string {
  return (e.bank_account_name?.trim() || e.full_name).toLocaleUpperCase("tr");
}

export const payrollRouter = router({
  /** Mağaza listesi (personel formu için) — marka adıyla. */
  stores: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.store.findMany({
      where: { deleted_at: null },
      include: { brand: { select: { name: true } } },
      orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    });
    return rows.map((s) => ({ id: s.id, name: s.name, brand_name: s.brand.name }));
  }),

  /**
   * Prim hesabında başvuru bilgisi: mağazanın o ayki kasa eksiği (Kasa
   * Farkları ile aynı motor) ve faturasız masraf toplamı (Faturasız Peşin
   * Ödeme girişleri). Kime kesileceğine sahibi karar verir — burası yalnız
   * rakamı gösterir.
   */
  storeHints: adminProcedure.input(periodKeySchema).query(async ({ ctx, input }) => {
    const from = new Date(Date.UTC(input.year, input.month - 1, 1));
    const to = new Date(Date.UTC(input.year, input.month, 1));
    const [cv, adv] = await Promise.all([
      cashVarianceSummary(ctx.prisma, { year: input.year, month: input.month }),
      ctx.prisma.cashAdvance.findMany({
        where: { category: { not: "bonus" }, daily_record: { date: { gte: from, lt: to } } },
        select: { amount_try: true, daily_record: { select: { store_id: true } } },
      }),
    ]);
    const un = new Map<string, { total: number; count: number }>();
    for (const a of adv) {
      const o = un.get(a.daily_record.store_id) ?? { total: 0, count: 0 };
      o.total += Number(a.amount_try);
      o.count += 1;
      un.set(a.daily_record.store_id, o);
    }
    return cv.by_store.map((s) => ({
      store_id: s.store_id,
      cash_deficit: Math.round(s.total_deficit * 100) / 100,
      cash_surplus: Math.round(s.total_surplus * 100) / 100,
      uninvoiced_total: Math.round((un.get(s.store_id)?.total ?? 0) * 100) / 100,
      uninvoiced_count: un.get(s.store_id)?.count ?? 0,
    }));
  }),

  // ── Kolay İK (salt okunur) ────────────────────────────────────────────────
  kolayik: router({
    /** Ayın mesai ve izin kayıtları, bordro personeline eşlenmiş. */
    month: adminProcedure.input(periodKeySchema).query(({ ctx, input }) => kolayikMonth(ctx.prisma, input.year, input.month)),
    /** Bir personelin izin bakiyeleri (id = PayrollEmployee.id). */
    leaveStatus: adminProcedure.input(idSchema).query(({ ctx, input }) => kolayikLeaveStatus(ctx.prisma, input.id)),
  }),

  // ── Personel ───────────────────────────────────────────────────────────────
  employees: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const rows = await ctx.prisma.payrollEmployee.findMany({
        where: { deleted_at: null },
        include: {
          store: { select: { id: true, name: true, brand: { select: { name: true } } } },
          loans: { include: { repayments: { select: { amount: true, voided_at: true } } } },
        },
        orderBy: [{ store: { name: "asc" } }, { sort_order: "asc" }, { full_name: "asc" }],
      });
      return rows.map((e) => ({
        id: e.id,
        store_id: e.store_id,
        store_name: e.store.name,
        brand_name: e.store.brand.name,
        full_name: e.full_name,
        position: e.position,
        commission_profile: e.commission_profile,
        base_salary: Number(e.base_salary),
        pay_method: e.pay_method,
        bank_account_name: e.bank_account_name,
        bank_branch_code: e.bank_branch_code,
        bank_account_no: e.bank_account_no,
        iban: e.iban,
        has_bank_details: !!(e.bank_branch_code && e.bank_account_no),
        is_registered: e.is_registered,
        is_gross_minimum: e.is_gross_minimum,
        perfume_eligible: e.perfume_eligible,
        garment_eligible: e.garment_eligible,
        paid_month_early: e.paid_month_early,
        nebim_name: e.nebim_name,
        aliases: e.aliases,
        start_date: e.start_date ? isoDate(e.start_date) : null,
        end_date: e.end_date ? isoDate(e.end_date) : null,
        status: e.status,
        notes: e.notes,
        loan_outstanding: e.loans
          .filter((l) => !l.closed_at)
          .reduce(
            (s, l) =>
              s +
              Number(l.principal) -
              Number(l.opening_repaid) -
              l.repayments.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.amount), 0),
            0
          ),
      }));
    }),

    create: employeeAudited.input(employeeCreateSchema).mutation(async ({ ctx, input }) => {
      const { start_date, ...rest } = input;
      const created = await ctx.prisma.payrollEmployee.create({
        data: { ...rest, start_date: start_date ? dateOnly(start_date) : null },
      });
      // Açık dönemlere satırını ekle
      const open = await ctx.prisma.payrollPeriod.findMany({ where: { status: "open" } });
      for (const p of open) await ensureLines(ctx.prisma, p.id);
      return created;
    }),

    update: employeeAudited.input(employeeUpdateSchema).mutation(async ({ ctx, input }) => {
      const { id, start_date, ...rest } = input;
      const data: Prisma.PayrollEmployeeUpdateInput = { ...rest };
      if (start_date !== undefined) data.start_date = start_date ? dateOnly(start_date) : null;
      return ctx.prisma.payrollEmployee.update({ where: { id }, data });
    }),

    /** İşten çıkış: durum left + end_date; açık dönemlerdeki satırı kalır (son bordro). */
    leave: employeeAudited.input(employeeLeaveSchema).mutation(async ({ ctx, input }) => {
      const e = await ctx.prisma.payrollEmployee.findUniqueOrThrow({ where: { id: input.id } });
      return ctx.prisma.payrollEmployee.update({
        where: { id: input.id },
        data: {
          status: "left",
          end_date: dateOnly(input.end_date),
          notes: input.note ? `${e.notes ? `${e.notes}\n` : ""}Ayrıldı ${input.end_date}: ${input.note}` : e.notes,
        },
      });
    }),

    /**
     * Eski bir Garanti talimat dosyasından şube / hesap / IBAN aktar — isimle
     * eşleşir (talimattaki isim veya tam ad). Dolu alan üzerine yazmaz.
     */
    importAccounts: employeeAudited.input(importAccountsSchema).mutation(async ({ ctx, input }) => {
      const rows = await parseGarantiTalimat(Buffer.from(input.file_base64, "base64"));
      const employees = await ctx.prisma.payrollEmployee.findMany({ where: { deleted_at: null } });
      const byKey = new Map<string, (typeof employees)[number]>();
      for (const e of employees) {
        byKey.set(normalizeName(e.full_name), e);
        if (e.bank_account_name) byKey.set(normalizeName(e.bank_account_name), e);
        for (const a of e.aliases) byKey.set(normalizeName(a), e);
      }
      const matched: string[] = [];
      const unmatched: string[] = [];
      for (const r of rows) {
        const e = byKey.get(normalizeName(r.name));
        if (!e) {
          unmatched.push(r.name);
          continue;
        }
        await ctx.prisma.payrollEmployee.update({
          where: { id: e.id },
          data: {
            bank_account_name: e.bank_account_name ?? r.name,
            bank_branch_code: e.bank_branch_code ?? r.branch_code,
            bank_account_no: e.bank_account_no ?? r.account_no,
            iban: e.iban ?? r.iban,
          },
        });
        matched.push(`${r.name} → ${e.full_name}`);
      }
      return { id: "import", matched, unmatched, rows: rows.length };
    }),
  }),

  // ── Dönemler ───────────────────────────────────────────────────────────────
  periods: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const rows = await ctx.prisma.payrollPeriod.findMany({
        orderBy: [{ year: "desc" }, { month: "desc" }],
        include: { _count: { select: { lines: true } } },
      });
      return rows.map((p) => ({
        id: p.id,
        year: p.year,
        month: p.month,
        label: periodLabel(p.year, p.month),
        status: p.status,
        lines: p._count.lines,
      }));
    }),

    open: periodAudited.input(periodKeySchema).mutation(async ({ ctx, input }) => {
      return ensurePeriod(ctx.prisma, input.year, input.month);
    }),

    get: adminProcedure.input(periodKeySchema).query(async ({ ctx, input }) => {
      const p = await ctx.prisma.payrollPeriod.findUnique({ where: { year_month: input } });
      if (!p) return null;
      return loadPeriodView(ctx.prisma, p.id);
    }),

    close: periodAudited.input(periodIdSchema).mutation(async ({ ctx, input }) => {
      const view = await loadPeriodView(ctx.prisma, input.period_id);
      if (!view) throw new TRPCError({ code: "NOT_FOUND" });
      if (view.totals.open > 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${view.totals.open} kişinin Net Kalan'ı sıfır değil — ay kapanamaz.`,
        });
      return ctx.prisma.payrollPeriod.update({
        where: { id: input.period_id },
        data: { status: "closed", closed_at: new Date() },
      });
    }),

    reopen: periodAudited.input(periodIdSchema).mutation(({ ctx, input }) =>
      ctx.prisma.payrollPeriod.update({ where: { id: input.period_id }, data: { status: "open", closed_at: null } })
    ),

    ensureLines: periodAudited.input(periodIdSchema).mutation(async ({ ctx, input }) => {
      const added = await ensureLines(ctx.prisma, input.period_id);
      return { id: input.period_id, added };
    }),

    updateNotes: periodAudited
      .input(periodIdSchema.extend({ notes: lineUpdateSchema.shape.note }))
      .mutation(({ ctx, input }) =>
        ctx.prisma.payrollPeriod.update({ where: { id: input.period_id }, data: { notes: input.notes } })
      ),
  }),

  // ── Satırlar (kişi × ay) ───────────────────────────────────────────────────
  lines: router({
    update: lineAudited.input(lineUpdateSchema).mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const line = await ctx.prisma.payrollLine.findUniqueOrThrow({ where: { id }, include: { period: true } });
      if (line.period.status === "closed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Kapalı ay — önce dönemi yeniden aç." });
      return ctx.prisma.payrollLine.update({ where: { id }, data });
    }),

    get: adminProcedure.input(idSchema).query(async ({ ctx, input }) => {
      const l = await ctx.prisma.payrollLine.findUnique({ where: { id: input.id }, include: lineInclude });
      if (!l) return null;
      const sm = await ctx.prisma.payrollStoreMonth.findUnique({
        where: { period_id_store_id: { period_id: l.period_id, store_id: l.store_id } },
      });
      return computeFromLine(l, { revenue: num(sm?.revenue), target: num(sm?.target) });
    }),
  }),

  // ── Mağaza ayı (ciro / hedef) ──────────────────────────────────────────────
  storeMonth: router({
    upsert: lineAudited.input(storeMonthUpsertSchema).mutation(({ ctx, input }) => {
      const { period_id, store_id, ...rest } = input;
      const data = {
        ...rest,
        revenue_source: rest.revenue !== undefined ? "manual" : undefined,
      };
      return ctx.prisma.payrollStoreMonth.upsert({
        where: { period_id_store_id: { period_id, store_id } },
        create: { period_id, store_id, ...data },
        update: data,
      });
    }),

    /** Derimod mağaza ve kişi cirolarını DocuFlow'daki Nebim satışlarından doldur (KDV hariç). */
    fillFromNebim: lineAudited.input(periodIdSchema).mutation(async ({ ctx, input }) => {
      const period = await ctx.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: input.period_id } });
      const rev = await derimodMonthRevenue(ctx.prisma, period.year, period.month);
      const stores = await ctx.prisma.store.findMany({
        where: { deleted_at: null, brand: { name: { contains: "derimod", mode: "insensitive" } } },
        select: { id: true, name: true },
      });
      const filledStores: string[] = [];
      const filledPeople: string[] = [];
      const unmatched: string[] = [];
      for (const s of stores) {
        const net = rev.by_store.get(s.id);
        if (net != null) {
          await ctx.prisma.payrollStoreMonth.upsert({
            where: { period_id_store_id: { period_id: period.id, store_id: s.id } },
            create: { period_id: period.id, store_id: s.id, revenue: net, revenue_source: "nebim" },
            update: { revenue: net, revenue_source: "nebim" },
          });
          filledStores.push(`${s.name}: ${net.toFixed(2)}`);
        }
        const lines = await ctx.prisma.payrollLine.findMany({
          where: { period_id: period.id, store_id: s.id, commission_profile: "deri_asistan" },
          include: { employee: true },
        });
        for (const l of lines) {
          const v = personRevenueFor(rev, s.id, [l.employee.nebim_name, l.employee.full_name, ...l.employee.aliases]);
          if (v == null) {
            unmatched.push(`${l.employee.full_name} (${s.name}; satıcılar: ${(rev.names_by_store.get(s.id) ?? []).join(", ") || "—"})`);
            continue;
          }
          await ctx.prisma.payrollLine.update({ where: { id: l.id }, data: { own_revenue: v } });
          filledPeople.push(`${l.employee.full_name}: ${v.toFixed(2)}`);
        }
      }
      return { id: period.id, filledStores, filledPeople, unmatched };
    }),
  }),

  // ── Kayıtlar (avans / ödeme / kesinti / ek) ────────────────────────────────
  entries: router({
    create: entryAudited.input(entryCreateSchema).mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.payrollLine.findUniqueOrThrow({ where: { id: input.line_id }, include: { period: true } });
      if (line.period.status === "closed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Kapalı ay — önce dönemi yeniden aç." });
      return ctx.prisma.payrollEntry.create({
        data: {
          line_id: line.id,
          period_id: line.period_id,
          employee_id: line.employee_id,
          kind: input.kind,
          category: input.category,
          channel: input.channel ?? null,
          entry_date: dateOnly(input.entry_date),
          amount: input.amount,
          note: input.note,
          reference: input.reference,
          loan_id: input.loan_id ?? null,
          created_by: ctx.user.id,
          created_by_name: ctx.user.full_name ?? ctx.user.email,
        },
      });
    }),

    /** Silinmez — iptal edilir; satırda üstü çizili kalır. */
    void: entryAudited.input(entryVoidSchema).mutation(({ ctx, input }) =>
      ctx.prisma.payrollEntry.update({
        where: { id: input.id },
        data: { voided_at: new Date(), void_note: input.note, voided_by: ctx.user.id },
      })
    ),
  }),

  // ── Talimat / nakit listesi ───────────────────────────────────────────────
  batches: router({
    /**
     * Talimat adayları: kanal + türe göre kişi listesi ve ödenecek tutar.
     * Ödeme 1'de "bir ay önceden ödenen" kişi (Hakan) GELECEK ayın satırıyla
     * gelir — bu yüzden mutation: gelecek dönem ve satırı yoksa açılır.
     */
    prepare: batchAudited.input(batchPreviewSchema).mutation(async ({ ctx, input }) => {
      const view = await loadPeriodView(ctx.prisma, input.period_id);
      if (!view) throw new TRPCError({ code: "NOT_FOUND" });
      const rows: Array<{
        line_id: string;
        employee_id: string;
        full_name: string;
        bank_name: string;
        store_name: string;
        base: number;
        advances: number;
        extras: number;
        deductions: number;
        net_remaining: number;
        due: number;
        has_bank_details: boolean;
        note: string | null;
        for_next_month: boolean;
      }> = [];
      const lines = view.stores.flatMap((s) => s.lines);
      for (const l of lines) {
        if (l.pay_method !== input.channel) continue;
        if (l.employee_status === "inactive") continue;
        if (input.kind === "payment1" && l.paid_month_early) continue; // gelecek ay satırıyla aşağıda
        let due = 0;
        if (input.kind === "payment1") due = l.calc.payment1_due;
        else if (input.kind === "payment2") due = l.calc.payment2_due;
        else if (input.kind === "single") due = Math.max(0, l.calc.net_remaining);
        else due = 0; // avans: kullanıcı yazar
        if (input.kind !== "advance" && due <= 0.005) continue;
        rows.push({
          line_id: l.id,
          employee_id: l.employee_id,
          full_name: l.full_name,
          bank_name: bankName(l),
          store_name: l.store_name,
          base: l.base_salary,
          advances: l.calc.advances_total,
          extras: l.calc.extras_total,
          deductions: l.calc.deductions_total,
          net_remaining: l.calc.net_remaining,
          due: Math.round(due * 100) / 100,
          has_bank_details: l.has_bank_details,
          note: l.calc.flags.find((f) => f.level !== "info")?.text ?? null,
          for_next_month: false,
        });
      }
      if (input.kind === "payment1") {
        const early = lines.filter((l) => l.paid_month_early && l.pay_method === input.channel && l.employee_status === "active");
        if (early.length > 0) {
          const nk = nextPeriodKey(view.period.year, view.period.month);
          const next = await ensurePeriod(ctx.prisma, nk.year, nk.month);
          const nextLines = await ctx.prisma.payrollLine.findMany({
            where: { period_id: next.id, employee_id: { in: early.map((e) => e.employee_id) } },
            include: lineInclude,
          });
          for (const nl of nextLines) {
            const c = computeFromLine(nl, { revenue: null, target: null });
            if (c.calc.payment1_due <= 0.005) continue;
            rows.push({
              line_id: nl.id,
              employee_id: nl.employee_id,
              full_name: c.full_name,
              bank_name: bankName(c),
              store_name: c.store_name,
              base: c.base_salary,
              advances: c.calc.advances_total,
              extras: c.calc.extras_total,
              deductions: c.calc.deductions_total,
              net_remaining: c.calc.net_remaining,
              due: c.calc.payment1_due,
              has_bank_details: c.has_bank_details,
              note: `${periodLabel(nk.year, nk.month)} maaşı — bir ay önceden ödenir`,
              for_next_month: true,
            });
          }
        }
      }
      return { id: input.period_id, rows };
    }),

    create: batchAudited.input(batchCreateSchema).mutation(async ({ ctx, input }) => {
      const lines = await ctx.prisma.payrollLine.findMany({
        where: { id: { in: input.items.map((i) => i.line_id) } },
        include: { employee: true, store: { select: { name: true } }, period: true },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const it of input.items) if (!byId.has(it.line_id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Satır bulunamadı" });
      const total = Math.round(input.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
      const period = await ctx.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: input.period_id } });
      const label = KIND_LABEL[input.kind];
      // Dosya yalnız Garanti için (bankaya e-posta). Ziraat ve nakit dosyasız:
      // kayıt anında ödendi sayılır (sahibi, 02.10.2026).
      const wantsFile = input.channel === "garanti";
      const paidNow = input.mark_sent || !wantsFile;
      const file_name = wantsFile ? talimatFileName(input.pay_date, label) : null;
      const title = input.title ?? `${periodLabel(period.year, period.month)} · ${label} · ${input.channel === "garanti" ? "Garanti" : input.channel === "cash" ? "Nakit" : "Ziraat"} · ${input.pay_date}`;

      const batch = await ctx.prisma.$transaction(async (tx) => {
        const b = await tx.payrollBatch.create({
          data: {
            period_id: input.period_id,
            kind: input.kind,
            channel: input.channel,
            status: paidNow ? "sent" : "prepared",
            sent_at: paidNow ? new Date() : null,
            pay_date: dateOnly(input.pay_date),
            title,
            total,
            count: input.items.length,
            file_name,
            created_by: ctx.user.id,
            created_by_name: ctx.user.full_name ?? ctx.user.email,
          },
        });
        await tx.payrollEntry.createMany({
          data: input.items.map((it) => {
            const l = byId.get(it.line_id)!;
            return {
              line_id: l.id,
              period_id: l.period_id,
              employee_id: l.employee_id,
              kind: input.kind === "advance" ? ("advance" as const) : ("payment" as const),
              category: input.kind === "advance" ? null : input.kind,
              channel: input.channel,
              entry_date: dateOnly(input.pay_date),
              amount: it.amount,
              note: l.period_id !== input.period_id ? `${periodLabel(l.period.year, l.period.month)} maaşı — bir ay önceden ödendi` : null,
              reference: file_name ?? (input.channel === "cash" ? "Nakit ödeme" : "Ziraat ödemesi"),
              batch_id: b.id,
              created_by: ctx.user.id,
              created_by_name: ctx.user.full_name ?? ctx.user.email,
            };
          }),
        });
        return b;
      });

      const file = wantsFile
        ? await buildBatchFile(input.channel, input.pay_date, title, input.items.map((it) => {
            const l = byId.get(it.line_id)!;
            return { employee: l.employee, store: l.store.name, amount: it.amount, scope: label };
          }))
        : null;
      return { id: batch.id, file_name, file_base64: file ? file.toString("base64") : null, total, count: input.items.length };
    }),

    download: adminProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.payrollBatch.findUniqueOrThrow({
        where: { id: input.id },
        include: { entries: { where: { voided_at: null }, include: { employee: true, line: { include: { store: { select: { name: true } } } } } } },
      });
      const file = await buildBatchFile(
        b.channel === "other" ? "cash" : b.channel,
        isoDate(b.pay_date),
        b.title,
        b.entries.map((e) => ({ employee: e.employee, store: e.line.store.name, amount: Number(e.amount), scope: KIND_LABEL[b.kind] }))
      );
      return { file_name: b.file_name ?? "talimat.xlsx", file_base64: file.toString("base64") };
    }),

    setStatus: batchAudited.input(batchStatusSchema).mutation(async ({ ctx, input }) => {
      if (input.status === "sent") {
        return ctx.prisma.payrollBatch.update({ where: { id: input.id }, data: { status: "sent", sent_at: new Date() } });
      }
      return ctx.prisma.$transaction(async (tx) => {
        await tx.payrollEntry.updateMany({
          where: { batch_id: input.id, voided_at: null },
          data: { voided_at: new Date(), void_note: input.note ?? "Talimat iptal edildi", voided_by: ctx.user.id },
        });
        return tx.payrollBatch.update({ where: { id: input.id }, data: { status: "void", voided_at: new Date() } });
      });
    }),
  }),

  // ── Borçlar ────────────────────────────────────────────────────────────────
  loans: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const rows = await ctx.prisma.payrollLoan.findMany({
        include: { employee: { select: { full_name: true } }, repayments: { include: { period: true }, orderBy: { entry_date: "asc" } } },
        orderBy: { created_at: "desc" },
      });
      return rows.map((l) => {
        const repaid = l.repayments.filter((r) => !r.voided_at).reduce((s, r) => s + Number(r.amount), 0);
        return {
          id: l.id,
          employee_id: l.employee_id,
          full_name: l.employee.full_name,
          category: l.category as "loan" | "work_permit",
          principal: Number(l.principal),
          opening_repaid: Number(l.opening_repaid),
          installment: l.installment != null ? Number(l.installment) : null,
          auto_deduct: l.auto_deduct,
          start_year: l.start_year,
          start_month: l.start_month,
          repaid,
          outstanding: Math.round((Number(l.principal) - Number(l.opening_repaid) - repaid) * 100) / 100,
          loan_date: l.loan_date ? isoDate(l.loan_date) : null,
          note: l.note,
          closed_at: l.closed_at ? l.closed_at.toISOString() : null,
          repayments: l.repayments.map((r) => ({
            id: r.id,
            date: isoDate(r.entry_date),
            amount: Number(r.amount),
            voided: !!r.voided_at,
            period: periodLabel(r.period.year, r.period.month),
          })),
        };
      });
    }),
    create: loanAudited.input(loanCreateSchema).mutation(async ({ ctx, input }) => {
      const loan = await ctx.prisma.payrollLoan.create({
        data: { ...input, loan_date: input.loan_date ? dateOnly(input.loan_date) : null },
      });
      // Açık dönemlere (başlangıç ayından itibaren) taksitleri hemen işle.
      if (loan.auto_deduct) await applyLoanToOpenPeriods(ctx.prisma, loan.id);
      return loan;
    }),
    update: loanAudited.input(loanUpdateSchema).mutation(async ({ ctx, input }) => {
      const { id, closed, ...rest } = input;
      const loan = await ctx.prisma.payrollLoan.update({
        where: { id },
        data: { ...rest, ...(closed === undefined ? {} : { closed_at: closed ? new Date() : null }) },
      });
      if (loan.auto_deduct && !loan.closed_at) await applyLoanToOpenPeriods(ctx.prisma, loan.id);
      return loan;
    }),
    close: loanAudited.input(idSchema).mutation(({ ctx, input }) =>
      ctx.prisma.payrollLoan.update({ where: { id: input.id }, data: { closed_at: new Date() } })
    ),
  }),

  // ── Kasadan verilen avanslar (DocuFlow günlük kayıtları) ──────────────────
  cashAdvances: router({
    suggest: adminProcedure.input(periodIdSchema).query(async ({ ctx, input }) => {
      const period = await ctx.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: input.period_id } });
      const from = new Date(Date.UTC(period.year, period.month - 1, 1));
      const to = new Date(Date.UTC(period.year, period.month, 1));
      const advances = await ctx.prisma.cashAdvance.findMany({
        where: { category: "bonus", staff_name: { not: null }, daily_record: { date: { gte: from, lt: to } } },
        include: { daily_record: { select: { date: true, store: { select: { id: true, name: true } } } } },
        orderBy: { created_at: "asc" },
      });
      if (advances.length === 0) return [];
      const linked = new Set(
        (
          await ctx.prisma.payrollEntry.findMany({
            where: { cash_advance_id: { in: advances.map((a) => a.id) } },
            select: { cash_advance_id: true },
          })
        ).map((e) => e.cash_advance_id)
      );
      const lines = await ctx.prisma.payrollLine.findMany({ where: { period_id: period.id }, include: { employee: true } });
      const byKey = new Map<string, (typeof lines)[number]>();
      for (const l of lines) {
        byKey.set(normalizeName(l.employee.full_name), l);
        for (const a of l.employee.aliases) byKey.set(normalizeName(a), l);
      }
      return advances
        .filter((a) => !linked.has(a.id))
        .map((a) => {
          const name = a.staff_name ?? "";
          const match =
            byKey.get(normalizeName(name)) ??
            lines.find((l) => normalizeName(l.employee.full_name).startsWith(normalizeName(name).split(" ")[0] ?? "§") && l.store_id === a.daily_record.store.id) ??
            null;
          return {
            cash_advance_id: a.id,
            date: isoDate(a.daily_record.date),
            store_name: a.daily_record.store.name,
            staff_name: name,
            amount: Number(a.amount_try),
            description: a.description,
            line_id: match?.id ?? null,
            matched_name: match?.employee.full_name ?? null,
          };
        });
    }),

    link: entryAudited.input(cashAdvanceLinkSchema).mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.cashAdvance.findUniqueOrThrow({
        where: { id: input.cash_advance_id },
        include: { daily_record: { select: { date: true, store: { select: { name: true } } } } },
      });
      const line = await ctx.prisma.payrollLine.findUniqueOrThrow({ where: { id: input.line_id } });
      return ctx.prisma.payrollEntry.create({
        data: {
          line_id: line.id,
          period_id: line.period_id,
          employee_id: line.employee_id,
          kind: "advance",
          channel: "cash",
          entry_date: a.daily_record.date,
          amount: a.amount_try,
          note: `Kasadan nakit avans (${a.daily_record.store.name})${a.description ? ` — ${a.description}` : ""}`,
          reference: "DocuFlow kasa avansı",
          cash_advance_id: a.id,
          created_by: ctx.user.id,
          created_by_name: ctx.user.full_name ?? ctx.user.email,
        },
      });
    }),
  }),

  // ── Bordro fişi ───────────────────────────────────────────────────────────
  payslip: router({
    get: adminProcedure.input(idSchema).query(async ({ ctx, input }) => {
      const l = await ctx.prisma.payrollLine.findUnique({ where: { id: input.id }, include: { ...lineInclude, period: true } });
      if (!l) return null;
      const sm = await ctx.prisma.payrollStoreMonth.findUnique({
        where: { period_id_store_id: { period_id: l.period_id, store_id: l.store_id } },
      });
      const line = computeFromLine(l, { revenue: num(sm?.revenue), target: num(sm?.target) });
      return {
        line,
        period: { id: l.period.id, year: l.period.year, month: l.period.month, label: periodLabel(l.period.year, l.period.month), status: l.period.status },
        store: { revenue: num(sm?.revenue), target: num(sm?.target) },
        employee: {
          bank_branch_code: l.employee.bank_branch_code,
          bank_account_no: l.employee.bank_account_no,
          pay_method: l.employee.pay_method,
          bank_account_name: l.employee.bank_account_name,
        },
      };
    }),
  }),
});

async function buildBatchFile(
  channel: "garanti" | "ziraat" | "cash",
  payDate: string,
  title: string,
  items: Array<{
    employee: { full_name: string; bank_account_name: string | null; bank_branch_code: string | null; bank_account_no: string | null; iban: string | null };
    store: string;
    amount: number;
    scope: string;
  }>
): Promise<Buffer> {
  if (channel === "garanti") {
    return buildGarantiTalimatXlsx(
      items.map((it) => ({
        name: bankName(it.employee),
        branch_code: it.employee.bank_branch_code,
        account_no: it.employee.bank_account_no,
        iban: it.employee.iban,
        amount: it.amount,
      })),
      payDate
    );
  }
  return buildCashListXlsx(
    title,
    items.map((it) => ({ name: it.employee.full_name, store: it.store, amount: it.amount, scope: it.scope }))
  );
}
