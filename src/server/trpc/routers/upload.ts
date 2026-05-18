import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  uploadCreateSchema,
  uploadIdSchema,
  uploadsForStoreDateSchema,
} from "@/lib/zod-schemas/upload";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import { getOrCreateDailyRecord } from "@/server/services/daily-record";
import {
  buildUploadPath,
  uploadBufferToStorage,
  createSignedReadUrl,
  deleteFromStorage,
} from "@/server/services/storage";

export const uploadRouter = router({
  /**
   * Create an upload:
   * 1. assert user can access store
   * 2. upsert DailyRecord for (store, date)
   * 3. push file to Supabase Storage at <store>/<dr>/<type>/<uuid>.<ext>
   * 4. insert Upload row (status='pending') — OCR will pick it up in Phase 4b
   */
  create: protectedProcedure
    .input(uploadCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);

      const dr = await getOrCreateDailyRecord(ctx.prisma, input.store_id, input.date);

      if (dr.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Bu gün kilitli, yükleme yapılamaz",
        });
      }

      const buffer = Buffer.from(input.file_base64, "base64");
      const path = buildUploadPath({
        storeId: input.store_id,
        dailyRecordId: dr.id,
        type: input.type,
        mimeType: input.mime_type,
      });
      await uploadBufferToStorage({
        path,
        buffer,
        mimeType: input.mime_type,
      });

      return ctx.prisma.upload.create({
        data: {
          daily_record_id: dr.id,
          type: input.type,
          file_url: path,
          mime_type: input.mime_type,
          file_size_bytes: buffer.length,
          uploaded_by: ctx.user.id,
          status: "pending",
        },
      });
    }),

  /** List uploads for a given store+date. */
  listForStoreDate: protectedProcedure
    .input(uploadsForStoreDateSchema)
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: day } },
      });
      if (!dr) return [];
      return ctx.prisma.upload.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { uploaded_at: "desc" },
        include: { uploaded_by_user: { select: { email: true, full_name: true } } },
      });
    }),

  /** Get a short-lived signed URL for downloading/previewing an upload. */
  signedUrl: protectedProcedure
    .input(uploadIdSchema)
    .query(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, upload.daily_record.store_id);
      const url = await createSignedReadUrl(upload.file_url);
      return { url };
    }),

  /** Delete an upload (storage + DB row). Locked days blocked. */
  delete: protectedProcedure
    .input(uploadIdSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, upload.daily_record.store_id);
      if (upload.daily_record.status === "locked" && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin silebilir",
        });
      }
      await deleteFromStorage(upload.file_url);
      await ctx.prisma.upload.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
