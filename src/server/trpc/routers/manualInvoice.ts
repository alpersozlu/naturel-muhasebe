import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  manualInvoiceCreateSchema,
  manualInvoiceIdSchema,
  manualInvoicesForStoreDateSchema,
} from "@/lib/zod-schemas/manual-invoice";
import { assertCanAccessStore, isAdmin } from "@/lib/auth/permissions";
import { getOrCreateDailyRecord } from "@/server/services/daily-record";

export const manualInvoiceRouter = router({
  /** Liste — bir mağazanın belirli günü için tüm el faturaları. */
  listForStoreDate: protectedProcedure
    .input(manualInvoicesForStoreDateSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: day } },
      });
      if (!dr) return [];
      return ctx.prisma.manualInvoice.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { created_at: "desc" },
        include: { created_by_user: { select: { full_name: true, email: true } } },
      });
    }),

  /** Yeni el faturası — kasiyer/müdür/admin ekleyebilir. */
  create: protectedProcedure
    .input(manualInvoiceCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dr = await getOrCreateDailyRecord(ctx.prisma, input.store_id, input.date);
      if (dr.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Bu gün kilitli, el faturası eklenemez",
        });
      }
      const amount_try = input.currency === "TRY" ? input.amount : input.amount;
      return ctx.prisma.manualInvoice.create({
        data: {
          daily_record_id: dr.id,
          amount: input.amount,
          currency: input.currency,
          amount_try,
          invoice_no: input.invoice_no || null,
          invoice_date: input.invoice_date
            ? new Date(`${input.invoice_date}T00:00:00.000Z`)
            : null,
          description: input.description || null,
          created_by: ctx.user.id,
        },
        include: { created_by_user: { select: { full_name: true, email: true } } },
      });
    }),

  /** Sil — admin her zaman, kasiyer kendi gününü ve gün kilitli değilse. */
  delete: protectedProcedure
    .input(manualInvoiceIdSchema)
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.manualInvoice.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, inv.daily_record.store_id);
      if (inv.daily_record.status === "locked" && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin silebilir",
        });
      }
      await ctx.prisma.manualInvoice.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
