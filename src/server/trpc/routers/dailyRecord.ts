import { TRPCError } from "@trpc/server";
import { router } from "../trpc";
import { dailyRecordIdSchema } from "@/lib/zod-schemas/verification";
import { withAudit } from "../middleware/audit";
import { assertCanAccessStore, isAdmin } from "@/lib/auth/permissions";
import {
  computeDay,
  persistVerification,
} from "@/server/services/verification/compute";

const dailyAdmin = withAudit("DailyRecord");

export const dailyRecordRouter = router({
  /**
   * Compute verification + mark day approved+locked.
   * Anyone with store access can approve; lock prevents non-admin edits.
   * Mismatch days can still be approved (admin override) but the
   * Verification row records the difference.
   */
  approveAndLock: dailyAdmin
    .input(dailyRecordIdSchema)
    .mutation(async ({ ctx, input }) => {
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { id: input.id },
        include: { store_summary: true },
      });
      if (!dr) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, dr.store_id);

      if (!dr.store_summary) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Mağaza Özeti yüklenmeden gün onaylanamaz",
        });
      }

      const result = await computeDay(ctx.prisma, input.id);
      await persistVerification(ctx.prisma, input.id, result);

      return ctx.prisma.dailyRecord.update({
        where: { id: input.id },
        data: {
          status: "locked",
          approved_by: ctx.user.id,
          approved_at: new Date(),
          locked_at: new Date(),
        },
        include: { verification: true },
      });
    }),

  /** Unlock a locked day. Admin only. */
  unlock: dailyAdmin
    .input(dailyRecordIdSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sadece admin kilidi açabilir",
        });
      }
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { id: input.id },
      });
      if (!dr) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.dailyRecord.update({
        where: { id: input.id },
        data: {
          status: "draft",
          approved_by: null,
          approved_at: null,
          locked_at: null,
        },
      });
    }),
});
