import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { verifyMonthSchema, verifyDaySchema } from "@/lib/zod-schemas/verification";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import {
  computeDay,
  persistVerification,
} from "@/server/services/verification/compute";
import { computeNebimDaySummary } from "@/server/services/nebim/day-summary";
import { optimumShareOfRecords } from "@/server/services/verification/optimum-share";

export const verificationRouter = router({
  /**
   * List all daily records for a (store, year, month) along with their
   * computed verification status. Days without records are not returned.
   */
  listForMonth: adminProcedure
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
          // Merged days ("Gün Birleşmesi") are shown as ONE card on the
          // verification page; each day still reports its own documents.
          merge_group: { select: { start_date: true, end_date: true } },
          // Optimum payı rozeti için (sahibi, 29.10.2026): banka bazında POS gün sonları.
          pos_slips: { select: { bank_name: true, net_amount_try: true, upload: { select: { status: true } } } },
          _count: {
            select: {
              pos_slips: true,
              bank_receipts: true,
              expenses: true,
              cash_advances: true,
              z_reports: true,
            },
          },
        },
      });
      // Optimum payı: birleşik günlerde grubun (bu ayda listelenen) tüm fişleri birlikte.
      const byGroup = new Map<string, typeof records>();
      for (const r of records) {
        if (!r.merge_group_id) continue;
        const g = byGroup.get(r.merge_group_id) ?? [];
        g.push(r);
        byGroup.set(r.merge_group_id, g);
      }
      return records.map(({ pos_slips: _slips, ...r }) => ({
        ...r,
        optimum: optimumShareOfRecords(r.merge_group_id ? (byGroup.get(r.merge_group_id) ?? []) : [{ pos_slips: _slips }]),
      }));
    }),

  /**
   * Compute (or re-compute) verification for one day and return the
   * full comparison breakdown. Persists Verification row.
   */
  compute: adminProcedure
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
  preview: adminProcedure
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
