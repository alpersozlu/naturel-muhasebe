import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import {
  uploadCreateSchema,
  uploadIdSchema,
  uploadsForStoreDateSchema,
} from "@/lib/zod-schemas/upload";
import { assertCanAccessStore } from "@/lib/auth/permissions";
import {
  getOrCreateDailyRecord,
  assertPriorDaysLocked,
} from "@/server/services/daily-record";
import {
  buildUploadPath,
  uploadBufferToStorage,
  createSignedReadUrl,
  deleteFromStorage,
} from "@/server/services/storage";
import { processUpload } from "@/server/services/ocr/process-upload";
import { claimNextPendingForward, forwardDealerReport, isIskontoConfigured } from "@/server/services/mavi-iskonto/forward";
import { checkZApproval } from "@/server/services/verification/z-rule";
import { waitUntil } from "@vercel/functions";

/**
 * A background OCR killed by the 60 s function limit never reaches its
 * catch; the row stays "processing" and counts as content for the
 * prior-day lock gate. 90 s is safely above the limit and short enough
 * that a manager who closed the tab is not blocked the next morning.
 */
const STALE_PROCESSING_MS = 90_000;

async function sweepStale(prisma: typeof import("@/lib/prisma").prisma, where: { daily_record_id?: string; daily_record?: { store_id: string } }) {
  await prisma.upload.updateMany({
    where: {
      ...where,
      status: { in: ["processing", "pending"] },
      uploaded_at: { lt: new Date(Date.now() - STALE_PROCESSING_MS) },
    },
    data: {
      status: "failed",
      error_message:
        "İşlem zaman aşımına uğradı — belge okunurken süre sınırı doldu. " +
        "\"Yeniden analiz et\" ile tekrar deneyin; olmazsa görseli biraz daha küçük çekin.",
    },
  });
}

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

      // Önceki günler kilitlenmeden yeni güne kayıt girilemez.
      await assertPriorDaysLocked(
        ctx.prisma,
        ctx.user,
        input.store_id,
        input.date
      );
      const dr = await getOrCreateDailyRecord(ctx.prisma, input.store_id, input.date);

      if (dr.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Bu gün kilitli, yükleme yapılamaz",
        });
      }

      // Dead "processing" rows of earlier days would trip the prior-day gate.
      await sweepStale(ctx.prisma, { daily_record: { store_id: input.store_id } });

      const buffer = Buffer.from(input.file_base64, "base64");
      const file_hash = createHash("sha256").update(buffer).digest("hex");

      // 🛡️ Fraud guard #1: exact-file replay.
      // Block if this same daily_record already has a non-failed upload
      // with the same SHA-256. Failed uploads are excluded so the user
      // can retry after a corrupted scan or OCR error.
      const existing = await ctx.prisma.upload.findFirst({
        where: {
          daily_record_id: dr.id,
          file_hash,
          status: { not: "failed" },
        },
        select: { id: true, type: true, uploaded_at: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Bu dosya bu güne zaten yüklenmiş (önceki kayıt: ${existing.uploaded_at.toLocaleString("tr-TR")}).`,
        });
      }

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

      const upload = await ctx.prisma.upload.create({
        data: {
          daily_record_id: dr.id,
          type: input.type,
          file_url: path,
          file_hash,
          mime_type: input.mime_type,
          file_size_bytes: buffer.length,
          uploaded_by: ctx.user.id,
          status: "pending",
          user_meta_json: input.user_meta ?? undefined,
        },
      });

      // Fire-and-forget OCR. waitUntil() pushes the work onto Vercel's
      // background runtime — the mutation returns in ~200ms while OCR
      // continues for up to maxDuration. UI polls listForStoreDate every
      // 3s while any row is pending/processing, so status flips to
      // 'parsed'/'failed' show up live.
      //
      // In local dev (no Vercel runtime), waitUntil falls through and
      // the promise just executes detached; we wrap in catch so any
      // unhandled rejection doesn't crash the dev server.
      waitUntil(
        processUpload(upload.id).catch((e) => {
          console.error("[upload.create] async OCR failed", e);
        })
      );

      return upload;
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

      // Arka plandaki OCR, fonksiyon süre sınırına takılınca sessizce ölür ve
      // catch bloğu hiç çalışmaz; kayıt "processing"de asılı kalır. Bu liste
      // her 3 sn'de bir çekildiği için ölü kayıtları burada süpürüyoruz:
      // maxDuration'ın çok üstünde bir yaş, canlı bir işi yakalamaz.
      await sweepStale(ctx.prisma, { daily_record_id: dr.id });

      // Dealer reports the discount-system hand-over has not reached (any
      // store, any day) go out one at a time in the background.
      const pendingForward = await claimNextPendingForward().catch(() => null);
      if (pendingForward) {
        waitUntil(
          forwardDealerReport(pendingForward).catch((e) => {
            console.error("[iskonto] background hand-over failed", e);
          })
        );
      }

      const rows = await ctx.prisma.upload.findMany({
        where: { daily_record_id: dr.id },
        orderBy: { uploaded_at: "desc" },
        include: {
          uploaded_by_user: { select: { email: true, full_name: true } },
          pos_slips: true,
          store_summary: true,
          bank_receipt: true,
          expense: true,
          z_report: true,
          dealer_daily_report: true,
        },
      });
      // The authenticity report explains HOW a fabricated document was
      // noticed; only admins get it. Everyone else sees that a document is
      // under review, nothing more.
      if (ctx.user.role === "admin") return rows;
      return rows.map((r) => ({ ...r, authenticity_json: null }));
    }),

  /** Admin: hand a dealer day-end file to the discount-control system (again). */
  forwardToIskonto: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!isIskontoConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Aktarım kapalı: Vercel'de MAVI_ISKONTO_PAROLA tanımlı değil.",
        });
      }
      const report = await ctx.prisma.dealerDailyReport.findUnique({ where: { upload_id: input.id } });
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Bu yüklemenin okunmuş bir bayi raporu yok." });
      const r = await forwardDealerReport(input.id);
      if (r.status === "failed") throw new TRPCError({ code: "BAD_GATEWAY", message: r.detail });
      return r;
    }),

  /**
   * Admin: close an authenticity flag after looking at the document.
   * "cleared" accepts it (a refused upload is read again, this time without
   * screening); "confirmed_fake" keeps it out for good.
   */
  reviewAuthenticity: adminProcedure
    .input(z.object({ id: z.string().uuid(), decision: z.enum(["cleared", "confirmed_fake"]) }))
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({ where: { id: input.id } });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.decision === "confirmed_fake") {
        await ctx.prisma.$transaction([
          ctx.prisma.posSlip.deleteMany({ where: { upload_id: upload.id } }),
          ctx.prisma.storeSummary.deleteMany({ where: { upload_id: upload.id } }),
          ctx.prisma.bankReceipt.deleteMany({ where: { upload_id: upload.id } }),
          ctx.prisma.expense.deleteMany({ where: { upload_id: upload.id } }),
          ctx.prisma.zReport.deleteMany({ where: { upload_id: upload.id } }),
          ctx.prisma.upload.update({
            where: { id: upload.id },
            data: {
              status: "failed",
              authenticity_verdict: "synthetic",
              authenticity_cleared_by: ctx.user.id,
              error_message:
                "Bu görsel yönetici incelemesinde geçersiz bulundu. Belgenin aslını telefonla çekip yeniden yükleyin.",
            },
          }),
        ]);
        return { ok: true, reprocessing: false };
      }
      const wasRefused = upload.status === "failed" && upload.authenticity_verdict === "synthetic";
      await ctx.prisma.upload.update({
        where: { id: upload.id },
        data: {
          authenticity_verdict: "cleared",
          authenticity_cleared_by: ctx.user.id,
          ...(wasRefused ? { status: "pending" as const, error_message: null, uploaded_at: new Date() } : {}),
        },
      });
      if (wasRefused) {
        waitUntil(
          processUpload(upload.id).catch((e) => {
            console.error("[upload.reviewAuthenticity] async OCR failed", e);
          })
        );
      }
      return { ok: true, reprocessing: wasRefused };
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

  /** Confirm a parsed upload (status: parsed → confirmed). */
  confirm: protectedProcedure
    .input(uploadIdSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, upload.daily_record.store_id);
      if (upload.status !== "parsed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sadece okunmuş (parsed) yüklemeler onaylanabilir",
        });
      }
      if (upload.daily_record.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli",
        });
      }
      // Z raporu için iş kuralı şart: Z+ManualInvoice ≤ KK*1.05 && < StoreSummary.sales_total
      if (upload.type === "z_report") {
        const check = await checkZApproval(ctx.prisma, upload.id);
        if (check && !check.passed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Z raporu onaylanamadı:\n${check.reasons.join("\n")}`,
          });
        }
      }
      return ctx.prisma.upload.update({
        where: { id: input.id },
        data: { status: "confirmed" },
      });
    }),

  /** Z raporu onay kuralı durumu — UI butonları için. */
  zApprovalCheck: protectedProcedure
    .input(uploadIdSchema)
    .query(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, upload.daily_record.store_id);
      if (upload.type !== "z_report") return null;
      return checkZApproval(ctx.prisma, upload.id);
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
      if (upload.type === "corporate_receipt") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Kurumsal alışveriş fişi tek başına silinemez; Kurumsal & Yönetim kartından alışveriş kaydını silin.",
        });
      }
      await ctx.prisma.upload.delete({ where: { id: input.id } });
      // Storage last: a failed object delete costs a stray file, a failed
      // row delete after the object is gone leaves a row that can never
      // be re-read.
      await deleteFromStorage(upload.file_url).catch((e) =>
        console.error("[upload.delete] storage cleanup failed", e)
      );
      return { ok: true };
    }),

  /**
   * Re-run OCR on a failed upload without uploading the photo again — after
   * a fix on our side (a crop, a prompt) the same photo may read fine, and a
   * transient failure (timeout, credit) should not cost the store a retake.
   */
  retry: protectedProcedure
    .input(uploadIdSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, upload.daily_record.store_id);
      if (upload.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Yalnız başarısız bir yükleme yeniden okunabilir.",
        });
      }
      if (upload.daily_record.status === "locked" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Gün kilitli." });
      }
      await ctx.prisma.upload.update({
        where: { id: input.id },
        data: {
          status: "pending",
          error_message: null,
          duplicate_of_id: null,
          date_mismatch: false,
          uploaded_at: new Date(), // stale-sweep clock restarts with the re-run
        },
      });
      waitUntil(
        processUpload(upload.id).catch((e) => {
          console.error("[upload.retry] async OCR failed", e);
        })
      );
      return { ok: true };
    }),

  /**
   * Admin: re-run OCR on a store summary the Nebim cross-check rejected,
   * this time without the cross-check. The check is right to flag the gap
   * (it caught the "Normal row" misread), but the bridge also carries
   * documents Nebim later cancelled while the printed report does not,
   * and a correct photo must not be un-uploadable. The decision is a
   * human's; the flag is kept on the upload for the audit trail.
   */
  acceptNebimGap: adminProcedure
    .input(uploadIdSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.prisma.upload.findUnique({
        where: { id: input.id },
        include: { daily_record: true },
      });
      if (!upload) throw new TRPCError({ code: "NOT_FOUND" });
      if (upload.type !== "store_summary" || upload.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Yalnız reddedilmiş bir Mağaza Özeti için kullanılabilir.",
        });
      }
      const meta = (upload.user_meta_json as Record<string, unknown> | null) ?? {};
      await ctx.prisma.upload.update({
        where: { id: input.id },
        data: {
          status: "pending",
          error_message: null,
          uploaded_at: new Date(), // stale-sweep clock restarts with the re-run
          user_meta_json: { ...meta, skip_nebim_check: true, accepted_by: ctx.user.id },
        },
      });
      waitUntil(
        processUpload(upload.id).catch((e) => {
          console.error("[upload.acceptNebimGap] async OCR failed", e);
        })
      );
      return { ok: true };
    }),
});
