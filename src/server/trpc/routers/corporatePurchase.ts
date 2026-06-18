import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  corporatePurchaseCreateSchema,
  corporatePurchaseIdSchema,
  corporatePurchaseSetPaidSchema,
  corporatePurchasesForStoreDateSchema,
} from "@/lib/zod-schemas/corporate-purchase";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import { getOrCreateDailyRecord } from "@/server/services/daily-record";

export const corporatePurchaseRouter = router({
  /** Bir mağaza+gün için kurumsal/yönetim alışverişleri. */
  listForStoreDate: protectedProcedure
    .input(corporatePurchasesForStoreDateSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: day } },
      });
      if (!dr) return [];
      return ctx.prisma.corporatePurchase.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { created_at: "desc" },
      });
    }),

  create: protectedProcedure
    .input(corporatePurchaseCreateSchema)
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
          message: "Bu gün kilitli, alışveriş eklenemez",
        });
      }
      // TODO: çoklu para birimi desteklenirse FX dönüşümü; şimdilik TRY varsayımı.
      const amount_try = input.amount;
      return ctx.prisma.corporatePurchase.create({
        data: {
          daily_record_id: dr.id,
          type: input.type,
          // Şirket adı yalnızca kurumsal için anlamlı
          company_name:
            input.type === "corporate" ? input.company_name ?? null : null,
          person_name: input.person_name!,
          amount: input.amount,
          currency: input.currency,
          amount_try,
          is_paid: input.is_paid,
          note: input.note ?? null,
        },
      });
    }),

  /** Borç durumunu güncelle (ödendi / borç). */
  setPaid: protectedProcedure
    .input(corporatePurchaseSetPaidSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.corporatePurchase.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, row.daily_record.store_id);
      return ctx.prisma.corporatePurchase.update({
        where: { id: input.id },
        data: { is_paid: input.is_paid },
      });
    }),

  delete: protectedProcedure
    .input(corporatePurchaseIdSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.corporatePurchase.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, row.daily_record.store_id);
      if (row.daily_record.status === "locked" && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin silebilir",
        });
      }
      await ctx.prisma.corporatePurchase.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
