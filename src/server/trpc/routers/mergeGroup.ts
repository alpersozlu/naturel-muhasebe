import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { router, protectedProcedure } from "../trpc";
import {
  mergeGroupCreateSchema,
  mergeGroupForStoreDateSchema,
  mergeGroupIdSchema,
  mergeProbeSchema,
} from "@/lib/zod-schemas/merge-group";
import { assertCanAccessStore, isAdmin } from "@/lib/auth/permissions";
import { LOCK_ENFORCEMENT_FROM } from "@/server/services/daily-record";
import { processUpload } from "@/server/services/ocr/process-upload";

/**
 * The SAP dealer report on the last day of a merged group is the total of the
 * whole group (process-upload → runDealerDailyReport). A report that was read
 * before the group existed — or is left behind when the group is dissolved —
 * covers the wrong span, so it is read again from the stored file.
 */
async function rereadDealerReports(prisma: PrismaClient, dailyRecordIds: string[]): Promise<void> {
  if (dailyRecordIds.length === 0) return;
  const uploads = await prisma.upload.findMany({
    where: {
      daily_record_id: { in: dailyRecordIds },
      type: "dealer_daily_report",
      status: { in: ["parsed", "confirmed"] },
    },
    select: { id: true },
  });
  for (const u of uploads) {
    await prisma.upload.update({ where: { id: u.id }, data: { status: "pending", error_message: null, uploaded_at: new Date() } });
    waitUntil(processUpload(u.id, { skipForward: true }).catch((e) => console.error("[mergeGroup] dealer report re-read failed", e)));
  }
}

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
   * Bu gün önceki bir günle birleştirilecekse NE olur? (Mavi "Kasa
   * Birleşmesi" kartı, onaydan önce gösterir.)
   *
   *   cumulative  önceki günün kendi mağaza özeti VAR → bu günün özeti
   *               kümülatiftir, önceki özet düşülür (dailyRecord.setCumulativePrev).
   *   group       önceki günün özeti YOK (kasa hiç kapatılamadı — örn.
   *               elektrik kesintisi) → günler tek özetle BİRLİKTE kapanır
   *               (mergeGroup.create).
   */
  probe: protectedProcedure
    .input(mergeProbeSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      if (input.prev_date >= input.date) {
        return { mode: "group" as const, days: 0, prev_has_summary: false, blocker: "Birleşilen gün, bu günden ÖNCE olmalı." };
      }
      const dates = eachDateInclusive(input.prev_date, input.date);
      const recs = await ctx.prisma.dailyRecord.findMany({
        where: { store_id: input.store_id, date: { in: dates } },
        select: { date: true, status: true, merge_group_id: true, store_summary: { select: { id: true } } },
      });
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const tr = (s: string) => s.split("-").reverse().join(".");
      const prev = recs.find((r) => iso(r.date) === input.prev_date);
      if (prev?.store_summary) {
        return { mode: "cumulative" as const, days: dates.length, prev_has_summary: true, blocker: null };
      }
      let blocker: string | null = null;
      if (dates.length > 3) blocker = "En fazla 3 gün birleştirilebilir.";
      for (const r of recs) {
        if (blocker) break;
        const d = iso(r.date);
        if (r.status === "locked") blocker = `${tr(d)} kilitli — birleşmeye dahil edilemez.`;
        else if (r.merge_group_id) blocker = `${tr(d)} zaten başka bir birleşmeye ait.`;
        else if (r.store_summary && d !== input.date) blocker = `${tr(d)} gününde zaten bir mağaza özeti var; birleşmede özet yalnız son güne yüklenir.`;
      }
      return { mode: "group" as const, days: dates.length, prev_has_summary: false, blocker };
    }),

  /**
   * Gün birleşmesi grubu oluştur. Aralıktaki her gün için DailyRecord
   * oluşturur/günceller, merge_group_id + merge_index (1-tabanlı) atar.
   * Son gün mağaza özetini (Mavi'de bayi gün sonu dosyasını da) taşır.
   *
   * Derimod: "Gün Birleşmesi" sihirbazı. Mavi: "Kasa Birleşmesi" kartı —
   * önceki günün özeti yoksa (04.10.2026, Mavi Güzelyurt: 01.10 kapanıştan
   * önce elektrik kesildi, kasa kapatılamadı; 02.10 özeti iki günü kapsıyor).
   */
  create: protectedProcedure
    .input(mergeGroupCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);

      const store = await ctx.prisma.store.findUnique({
        where: { id: input.store_id },
        include: { brand: true },
      });
      if (!store) throw new TRPCError({ code: "NOT_FOUND" });

      const dates = eachDateInclusive(input.start_date, input.end_date);

      // Aralıktaki günlerden herhangi biri zaten BAŞKA bir gruba/kilide aitse engelle
      const existing = await ctx.prisma.dailyRecord.findMany({
        where: {
          store_id: input.store_id,
          date: { in: dates },
        },
        select: { id: true, date: true, status: true, merge_group_id: true, store_summary: { select: { id: true } } },
      });
      const lastIso = input.end_date;
      for (const dr of existing) {
        // The group's summary lives on its LAST day; an earlier day that
        // already has its own summary would be picked as the group's.
        if (dr.store_summary && dr.date.toISOString().slice(0, 10) !== lastIso) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${dr.date.toISOString().slice(0, 10)} gününde zaten bir Mağaza Özeti var; birleşmede özet yalnız son güne yüklenir. Önce o özeti silin.`,
          });
        }
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

      // A dealer report already on file for the last day was read as a single
      // day; it now has to carry the whole group.
      const last = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: endDate } },
        select: { id: true },
      });
      if (last) await rereadDealerReports(ctx.prisma, [last.id]);

      return group;
    }),

  /** Bir mağaza+tarih bir birleşme grubuna ait mi? Grup + tüm günleri döner. */
  /**
   * The store's newest merge group that is still open (any day unlocked).
   * The wizard resumes from it: its progress used to live only in React
   * state, so a reload or a switch to "Tek Gün" after day 1 lost the group
   * (Derimod Lefkoşa 20–21.09.2026: day 1 uploaded, day 2 and the summary
   * never reached, the next day blocked by the lock gate).
   */
  getOpenForStore: protectedProcedure
    .input(mergeGroupForStoreDateSchema.pick({ store_id: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const today = new Date().toISOString().slice(0, 10);
      const include = {
        daily_records: {
          orderBy: { date: "asc" as const },
          select: {
            id: true,
            date: true,
            merge_index: true,
            status: true,
            store_summary: { select: { id: true } },
            _count: { select: { uploads: { where: { status: { not: "failed" as const } } } } },
          },
        },
      };
      const groups = await ctx.prisma.dayMergeGroup.findMany({
        where: {
          store_id: input.store_id,
          daily_records: { some: { status: { not: "locked" } } },
          // Not before go-live (admin test data), not in the future (a
          // range typed by mistake — measured: 29–30.09 and 14–16.09 groups
          // sat beside the real 20–21.09 one).
          start_date: { gte: new Date(`${LOCK_ENFORCEMENT_FROM}T00:00:00.000Z`), lte: new Date(`${today}T00:00:00.000Z`) },
        },
        orderBy: { start_date: "asc" },
        include,
      });
      // The one with documents in it is the one being worked on; the oldest
      // such group is also the one the lock gate is waiting for.
      return groups.find((g) => g.daily_records.some((d) => d._count.uploads > 0)) ?? groups[groups.length - 1] ?? null;
    }),

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
      // Back to single days: the last day's dealer report covered the group.
      await rereadDealerReports(
        ctx.prisma,
        group.daily_records.map((d) => d.id)
      );
      return { ok: true };
    }),
});
