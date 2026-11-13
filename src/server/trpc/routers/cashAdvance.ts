import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  cashAdvanceCreateSchema,
  cashAdvanceIdSchema,
  cashAdvancesForStoreDateSchema,
} from "@/lib/zod-schemas/cash-advance";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import {
  getOrCreateDailyRecord,
  assertPriorDaysLocked,
} from "@/server/services/daily-record";
import {
  isPayrollCashCategory,
  linkCashAdvanceToPayroll,
  staffRoleFromPosition,
  unlinkCashAdvanceFromPayroll,
} from "@/server/services/payroll/cash-link";
import { z } from "zod";

export const cashAdvanceRouter = router({
  /** List recent cash advances for a given store+date. */
  listForStoreDate: protectedProcedure
    .input(cashAdvancesForStoreDateSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: day } },
      });
      if (!dr) return [];
      const rows = await ctx.prisma.cashAdvance.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { created_at: "desc" },
        include: { employee: { select: { full_name: true, email: true } } },
      });
      // Maaş / Prim-Avans ödemesi bordroya düştü mü? Mağaza görsün.
      const linked = new Set(
        (
          await ctx.prisma.payrollEntry.findMany({
            where: { cash_advance_id: { in: rows.map((r) => r.id) }, voided_at: null },
            select: { cash_advance_id: true },
          })
        ).map((e) => e.cash_advance_id)
      );
      return rows.map((r) => ({
        ...r,
        payroll_linked: linked.has(r.id),
        payroll_pending: isPayrollCashCategory(r.category) && !linked.has(r.id),
      }));
    }),

  /**
   * Mağazanın bordro kadrosu — Maaş / Prim-Avans ödemesinde kişi buradan
   * seçilir, ödeme kendiliğinden o kişinin bordrosuna düşer. Mağaza
   * kullanıcısına da açık (yalnız kendi mağazası, yalnız ad ve ünvan).
   */
  staffOptions: protectedProcedure
    .input(z.object({ store_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const people = await ctx.prisma.payrollEmployee.findMany({
        where: { store_id: input.store_id, deleted_at: null, status: { in: ["active", "inactive"] } },
        select: { id: true, full_name: true, position: true },
        orderBy: [{ sort_order: "asc" }, { full_name: "asc" }],
      });
      return people.map((p) => ({ ...p, staff_role: staffRoleFromPosition(p.position) }));
    }),

  create: protectedProcedure
    .input(cashAdvanceCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      // Önceki günler kilitlenmeden yeni güne kayıt girilemez.
      await assertPriorDaysLocked(
        ctx.prisma,
        ctx.user,
        input.store_id,
        input.date
      );
      const dr = await getOrCreateDailyRecord(
        ctx.prisma,
        input.store_id,
        input.date
      );
      if (dr.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Bu gün kilitli, peşin ödeme eklenemez",
        });
      }
      const amount_try = input.currency === "TRY" ? input.amount : input.amount;

      // Maaş / Prim-Avans: kişi bordro listesinden seçildiyse isim ve rol
      // ondan alınır (elle yazım yanlış eşleşmesin).
      const toPayroll = isPayrollCashCategory(input.category);
      let staffName = toPayroll ? input.staff_name ?? null : null;
      let staffRole = toPayroll ? input.staff_role ?? null : null;
      let payrollEmployeeId: string | null = null;
      if (toPayroll && input.payroll_employee_id) {
        const person = await ctx.prisma.payrollEmployee.findUnique({
          where: { id: input.payroll_employee_id },
          select: { id: true, store_id: true, full_name: true, position: true, deleted_at: true },
        });
        if (!person || person.deleted_at || person.store_id !== input.store_id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Seçilen personel bu mağazanın kadrosunda değil." });
        }
        payrollEmployeeId = person.id;
        staffName = person.full_name;
        staffRole = staffRoleFromPosition(person.position);
      }

      const created = await ctx.prisma.cashAdvance.create({
        data: {
          daily_record_id: dr.id,
          employee_id: input.employee_id ?? null,
          amount: input.amount,
          currency: input.currency,
          amount_try,
          category: input.category,
          description: input.description || null,
          // Maaş ve Prim/Avans'ta kişi zorunlu; diğer kategorilerde null
          staff_role: staffRole,
          staff_name: staffName,
        },
        include: { employee: { select: { full_name: true, email: true } } },
      });

      // Bordroya yansıt — ödeme o kişinin o ayki hak edişinden düşsün.
      const payroll = toPayroll
        ? await linkCashAdvanceToPayroll(ctx.prisma, {
            cash_advance_id: created.id,
            employee_id: payrollEmployeeId,
            user_id: ctx.user.id,
            user_name: ctx.user.full_name ?? ctx.user.email,
          }).catch((e) => {
            console.error("[cashAdvance.create] bordro bağlantısı kurulamadı", e);
            return { linked: false as const, reason: "no_line" as const };
          })
        : { linked: false as const, reason: "not_payroll" as const };

      return { ...created, payroll };
    }),

  delete: protectedProcedure
    .input(cashAdvanceIdSchema)
    .mutation(async ({ ctx, input }) => {
      const adv = await ctx.prisma.cashAdvance.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!adv) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, adv.daily_record.store_id);
      if (adv.daily_record.status === "locked" && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin silebilir",
        });
      }
      // Bordroya işlendiyse oradaki kaydı da kaldır — yoksa kişi bir daha
      // ödenmemiş para için kesinti yemiş kalır.
      const un = await unlinkCashAdvanceFromPayroll(ctx.prisma, input.id);
      if (un.blocked) throw new TRPCError({ code: "BAD_REQUEST", message: un.blocked });
      await ctx.prisma.cashAdvance.delete({ where: { id: input.id } });
      return { ok: true, payroll_entry_removed: un.removed };
    }),
});
