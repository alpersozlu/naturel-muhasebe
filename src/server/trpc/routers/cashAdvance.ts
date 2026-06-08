import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  cashAdvanceCreateSchema,
  cashAdvanceIdSchema,
  cashAdvancesForStoreDateSchema,
} from "@/lib/zod-schemas/cash-advance";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import { getOrCreateDailyRecord } from "@/server/services/daily-record";

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
      return ctx.prisma.cashAdvance.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { created_at: "desc" },
        include: { employee: { select: { full_name: true, email: true } } },
      });
    }),

  create: protectedProcedure
    .input(cashAdvanceCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
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
      return ctx.prisma.cashAdvance.create({
        data: {
          daily_record_id: dr.id,
          employee_id: input.employee_id ?? null,
          amount: input.amount,
          currency: input.currency,
          amount_try,
          category: input.category,
          description: input.description || null,
          // Avans (bonus) için rol + isim; diğer kategorilerde null
          staff_role: input.category === "bonus" ? input.staff_role ?? null : null,
          staff_name: input.category === "bonus" ? input.staff_name ?? null : null,
        },
        include: { employee: { select: { full_name: true, email: true } } },
      });
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
      await ctx.prisma.cashAdvance.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
