import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";

const storeAdmin = withAudit("Store");
import {
  storeCreateSchema,
  storeUpdateSchema,
  storeIdSchema,
  storesByBrandSchema,
  storeMonthlyCalendarSchema,
} from "@/lib/zod-schemas/store";
import {
  assertCanAccessBrand,
  assertCanAccessStore,
  getAccessibleStoreIds,
  isAdmin,
} from "@/lib/auth/permissions";

export const storeRouter = router({
  /**
   * Admin → brand'in tüm mağazaları.
   * store_manager/cashier → atanmış oldukları ve brand'e ait olanlar.
   */
  listByBrand: protectedProcedure
    .input(storesByBrandSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessBrand(ctx.user, input.brand_id);
      if (isAdmin(ctx.user)) {
        return ctx.prisma.store.findMany({
          where: { brand_id: input.brand_id, deleted_at: null },
          orderBy: { name: "asc" },
        });
      }
      const accessibleIds = await getAccessibleStoreIds(ctx.user);
      if (accessibleIds.length === 0) return [];
      return ctx.prisma.store.findMany({
        where: {
          id: { in: accessibleIds },
          brand_id: input.brand_id,
          deleted_at: null,
        },
        orderBy: { name: "asc" },
      });
    }),

  get: protectedProcedure.input(storeIdSchema).query(async ({ ctx, input }) => {
    await assertCanAccessStore(ctx.user, input.id);
    const store = await ctx.prisma.store.findUnique({
      where: { id: input.id },
      include: { brand: true },
    });
    if (!store || store.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return store;
  }),

  create: storeAdmin.input(storeCreateSchema).mutation(async ({ ctx, input }) => {
    const brand = await ctx.prisma.brand.findUnique({ where: { id: input.brand_id } });
    if (!brand || brand.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Marka bulunamadı" });
    }
    return ctx.prisma.store.create({
      data: {
        brand_id: input.brand_id,
        name: input.name,
        city: input.city ?? null,
        address: input.address ?? null,
      },
    });
  }),

  update: storeAdmin.input(storeUpdateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.store.findUnique({ where: { id: input.id } });
    if (!existing || existing.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return ctx.prisma.store.update({
      where: { id: input.id },
      data: {
        name: input.name,
        city: input.city ?? null,
        address: input.address ?? null,
      },
    });
  }),

  softDelete: storeAdmin.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: new Date() },
    })
  ),

  restore: storeAdmin.input(storeIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.store.update({
      where: { id: input.id },
      data: { deleted_at: null },
    })
  ),

  /**
   * Aylık takvim görünümü — bir mağaza için her günün durumu.
   * Apple-tarzı takvim grid'inde gün kutularını renklendirmek için kullanılır.
   *
   * status:
   *   - empty:    Bu güne hiç yükleme yapılmamış (DailyRecord yok)
   *   - error:    En az bir upload "failed" durumda
   *   - partial:  Yüklemeler var ama tamamlanmamış / verification yok
   *   - verified: Tüm zorunlular yüklenmiş, verification.status = match, daily_record approved
   *   - locked:   daily_record.status = locked (geçmiş kilitlenmiş gün)
   */
  getMonthlyCalendar: protectedProcedure
    .input(storeMonthlyCalendarSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);

      const start = new Date(Date.UTC(input.year, input.month - 1, 1));
      const endExclusive = new Date(Date.UTC(input.year, input.month, 1));
      const daysInMonth = new Date(input.year, input.month, 0).getDate();

      const records = await ctx.prisma.dailyRecord.findMany({
        where: {
          store_id: input.store_id,
          date: { gte: start, lt: endExclusive },
        },
        include: {
          uploads: { select: { id: true, type: true, status: true } },
          verification: { select: { status: true } },
          z_reports: { select: { id: true } },
          store_summary: { select: { id: true } },
          pos_slips: { select: { id: true } },
        },
      });

      const byDate = new Map<string, (typeof records)[number]>();
      for (const r of records) {
        const iso = r.date.toISOString().slice(0, 10);
        byDate.set(iso, r);
      }

      type DayStatus =
        | "empty"
        | "error"
        | "partial"
        | "verified"
        | "locked";

      const days: Array<{
        iso: string;
        day: number;
        status: DayStatus;
        upload_count: number;
        has_z: boolean;
        has_store_summary: boolean;
        pos_slip_count: number;
        verification: "match" | "mismatch" | "manual_override" | null;
        daily_record_status: "draft" | "pending" | "approved" | "locked" | null;
      }> = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${input.year}-${String(input.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const r = byDate.get(iso);
        if (!r) {
          days.push({
            iso,
            day: d,
            status: "empty",
            upload_count: 0,
            has_z: false,
            has_store_summary: false,
            pos_slip_count: 0,
            verification: null,
            daily_record_status: null,
          });
          continue;
        }
        const hasFailed = r.uploads.some((u) => u.status === "failed");
        const verification = r.verification?.status ?? null;
        const isLocked = r.status === "locked";
        const hasZ = r.z_reports.length > 0;
        const hasSummary = r.store_summary !== null;
        const posCount = r.pos_slips.length;
        const verifiedComplete =
          hasZ &&
          hasSummary &&
          posCount > 0 &&
          verification === "match" &&
          (r.status === "approved" || r.status === "locked");

        let status: DayStatus;
        if (isLocked) status = "locked";
        else if (hasFailed) status = "error";
        else if (verifiedComplete) status = "verified";
        else status = "partial";

        days.push({
          iso,
          day: d,
          status,
          upload_count: r.uploads.length,
          has_z: hasZ,
          has_store_summary: hasSummary,
          pos_slip_count: posCount,
          verification,
          daily_record_status: r.status,
        });
      }

      return { days };
    }),
});
