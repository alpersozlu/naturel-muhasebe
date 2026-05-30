import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  mergeGroupCreateSchema,
  mergeGroupForStoreDateSchema,
  mergeGroupIdSchema,
} from "@/lib/zod-schemas/merge-group";
import { assertCanAccessStore, isAdmin } from "@/lib/auth/permissions";

function eachDateInclusive(startIso: string, endIso: string): Date[] {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  const out: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export const mergeGroupRouter = router({
  /**
   * Gün birleşmesi grubu oluştur (Derimod). Aralıktaki her gün için DailyRecord
   * oluşturur/günceller, merge_group_id + merge_index (1-tabanlı) atar.
   * Son gün mağaza özetini taşır.
   */
  create: protectedProcedure
    .input(mergeGroupCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);

      // Sadece Derimod markası için (Mavi farklı sistem — sonraki aşama)
      const store = await ctx.prisma.store.findUnique({
        where: { id: input.store_id },
        include: { brand: true },
      });
      if (!store) throw new TRPCError({ code: "NOT_FOUND" });
      const brandLower = store.brand.name
        .toLocaleLowerCase("tr")
        .replace(/ı/g, "i");
      if (!brandLower.includes("derimod")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Gün birleşmesi şu an sadece Derimod mağazaları için aktif. Mavi sistemi farklı.",
        });
      }

      const dates = eachDateInclusive(input.start_date, input.end_date);

      // Aralıktaki günlerden herhangi biri zaten BAŞKA bir gruba/kilide aitse engelle
      const existing = await ctx.prisma.dailyRecord.findMany({
        where: {
          store_id: input.store_id,
          date: { in: dates },
        },
        select: { id: true, date: true, status: true, merge_group_id: true },
      });
      for (const dr of existing) {
        if (dr.status === "locked") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `${dr.date.toISOString().slice(0, 10)} kilitli — birleşmeye dahil edilemez.`,
          });
        }
        if (dr.merge_group_id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${dr.date.toISOString().slice(0, 10)} zaten başka bir birleşmeye ait.`,
          });
        }
      }

      const startDate = new Date(`${input.start_date}T00:00:00.000Z`);
      const endDate = new Date(`${input.end_date}T00:00:00.000Z`);

      // Grup + günleri tek transaction'da
      const group = await ctx.prisma.$transaction(async (tx) => {
        const g = await tx.dayMergeGroup.create({
          data: {
            store_id: input.store_id,
            start_date: startDate,
            end_date: endDate,
            created_by: ctx.user.id,
          },
        });
        for (let i = 0; i < dates.length; i++) {
          const day = dates[i]!;
          await tx.dailyRecord.upsert({
            where: {
              store_id_date: { store_id: input.store_id, date: day },
            },
            update: { merge_group_id: g.id, merge_index: i + 1 },
            create: {
              store_id: input.store_id,
              date: day,
              status: "draft",
              merge_group_id: g.id,
              merge_index: i + 1,
            },
          });
        }
        return g;
      });

      return group;
    }),

  /** Bir mağaza+tarih bir birleşme grubuna ait mi? Grup + tüm günleri döner. */
  getForStoreDate: protectedProcedure
    .input(mergeGroupForStoreDateSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: day } },
        select: { merge_group_id: true },
      });
      if (!dr?.merge_group_id) return null;
      return ctx.prisma.dayMergeGroup.findUnique({
        where: { id: dr.merge_group_id },
        include: {
          daily_records: {
            orderBy: { date: "asc" },
            select: {
              id: true,
              date: true,
              merge_index: true,
              status: true,
              store_summary: { select: { id: true } },
            },
          },
        },
      });
    }),

  /** Birleşme grubunu sil (günlerin merge bağını kaldırır, grubu siler). */
  delete: protectedProcedure
    .input(mergeGroupIdSchema)
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.dayMergeGroup.findUnique({
        where: { id: input.id },
        include: { daily_records: { select: { id: true, status: true } } },
      });
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, group.store_id);
      const anyLocked = group.daily_records.some((d) => d.status === "locked");
      if (anyLocked && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Kilitli gün içeren birleşme yalnızca admin tarafından bozulabilir.",
        });
      }
      await ctx.prisma.$transaction(async (tx) => {
        await tx.dailyRecord.updateMany({
          where: { merge_group_id: input.id },
          data: { merge_group_id: null, merge_index: null },
        });
        await tx.dayMergeGroup.delete({ where: { id: input.id } });
      });
      return { ok: true };
    }),
});
