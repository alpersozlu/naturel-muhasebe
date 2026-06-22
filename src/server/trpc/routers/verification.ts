import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { verifyMonthSchema, verifyDaySchema } from "@/lib/zod-schemas/verification";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import {
  computeDay,
  persistVerification,
} from "@/server/services/verification/compute";
import { computeNebimDaySummary } from "@/server/services/nebim/day-summary";

export const verificationRouter = router({
  /**
   * List all daily records for a (store, year, month) along with their
   * computed verification status. Days without records are not returned.
   */
  listForMonth: protectedProcedure
    .input(verifyMonthSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const start = new Date(Date.UTC(input.year, input.month - 1, 1));
      const end = new Date(Date.UTC(input.year, input.month, 1));
      const records = await ctx.prisma.dailyRecord.findMany({
        where: {
          store_id: input.store_id,
          date: { gte: start, lt: end },
        },
        orderBy: { date: "asc" },
        include: {
          verification: true,
          store_summary: true,
          dealer_daily_report: true,
          store: { select: { brand: { select: { name: true } } } },
          _count: {
            select: {
              pos_slips: true,
              bank_receipts: true,
              expenses: true,
              cash_advances: true,
            },
          },
        },
      });
      return records;
    }),

  /**
   * Compute (or re-compute) verification for one day and return the
   * full comparison breakdown. Persists Verification row.
   */
  compute: protectedProcedure
    .input(verifyDaySchema)
    .mutation(async ({ ctx, input }) => {
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { id: input.daily_record_id },
      });
      if (!dr) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, dr.store_id);

      const result = await computeDay(ctx.prisma, input.daily_record_id);
      await persistVerification(ctx.prisma, input.daily_record_id, result);
      return result;
    }),

  /** Read-only compute without persisting (for live preview). */
  preview: protectedProcedure
    .input(verifyDaySchema)
    .query(async ({ ctx, input }) => {
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { id: input.daily_record_id },
      });
      if (!dr) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, dr.store_id);
      const result = await computeDay(ctx.prisma, input.daily_record_id);
      // NEBİM canlı server karşılaştırması (Derimod 3. kontrol) — varsa ekle.
      const nebim_summary = await computeNebimDaySummary(
        ctx.prisma,
        input.daily_record_id
      );
      return { ...result, nebim_summary };
    }),
});
