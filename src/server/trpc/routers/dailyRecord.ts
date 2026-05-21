import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import {
  dailyRecordIdSchema,
  setReportedCashSchema,
} from "@/lib/zod-schemas/verification";
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

  /**
   * Gün uzlaşması özeti — /upload sayfasında "Gün Uzlaşması" panelinde
   * kullanılır. Hangi belgeler var, hangileri eksik, mutabakat durumu
   * (yapılabiliyorsa) ve müdür kasa sayım tespiti.
   */
  reconciliation: protectedProcedure
    .input(setReportedCashSchema.pick({ store_id: true, date: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        include: {
          uploads: { select: { id: true, type: true, status: true } },
          store_summary: true,
          z_reports: { select: { id: true } },
          pos_slips: {
            select: {
              id: true,
              upload: { select: { status: true } },
            },
          },
          bank_receipts: { select: { id: true } },
          manual_invoices: { select: { id: true, amount_try: true } },
        },
      });

      if (!dr) {
        return {
          exists: false,
          status: "empty" as const,
          has_z: false,
          has_summary: false,
          pos_count: 0,
          has_reported_cash: false,
          has_bank_receipt: false,
          requires_cash_proof: false,
          manual_invoice_count: 0,
          failed_count: 0,
          daily_record_status: null,
          daily_record_id: null,
          reconciliation_notes: null,
          reconciliation_notes_at: null,
          verification: null,
        };
      }

      const hasZ = dr.z_reports.length > 0;
      const hasSummary = dr.store_summary !== null;
      const posCount = dr.pos_slips.filter(
        (p) => p.upload.status === "parsed" || p.upload.status === "confirmed"
      ).length;
      const hasReportedCash = dr.reported_cash_try !== null;
      const hasBankReceipt = dr.bank_receipts.length > 0;
      const failedCount = dr.uploads.filter((u) => u.status === "failed").length;
      // Mağaza özeti nakit > 0 ise dekont/sayım gerekli; 0 ise POS-only gün, gerekmez
      const cashSales = dr.store_summary?.cash_sales_try?.toNumber() ?? 0;
      const requiresCashProof = hasSummary && cashSales > 0.01;

      // Mutabakat hesaplayabilir miyiz? Mağaza Özeti gerekli.
      const verification = hasSummary
        ? await computeDay(ctx.prisma, dr.id)
        : null;

      let status:
        | "empty"
        | "incomplete"
        | "ready"
        | "match"
        | "mismatch"
        | "locked"
        | "error";
      if (dr.status === "locked") status = "locked";
      else if (failedCount > 0) status = "error";
      else if (!hasSummary || !hasZ || posCount === 0) status = "incomplete";
      else if (!verification) status = "ready";
      else if (verification.status === "match") status = "match";
      else status = "mismatch";

      return {
        exists: true,
        status,
        has_z: hasZ,
        has_summary: hasSummary,
        pos_count: posCount,
        has_reported_cash: hasReportedCash,
        has_bank_receipt: hasBankReceipt,
        requires_cash_proof: requiresCashProof,
        manual_invoice_count: dr.manual_invoices.length,
        failed_count: failedCount,
        daily_record_status: dr.status,
        daily_record_id: dr.id,
        reconciliation_notes: dr.reconciliation_notes,
        reconciliation_notes_at: dr.reconciliation_notes_at,
        verification: verification
          ? {
              status: verification.status,
              expected_total: verification.expected_total,
              actual_total: verification.actual_total,
              difference: verification.difference,
              notes: verification.notes,
              rows: verification.rows,
            }
          : null,
      };
    }),

  /** Mevcut müdür nakit girişini oku (form'u doldurmak için). */
  getReportedCash: protectedProcedure
    .input(setReportedCashSchema.pick({ store_id: true, date: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        select: {
          reported_cash_try: true,
          reported_cash_note: true,
          reported_cash_at: true,
        },
      });
      return dr;
    }),

  /**
   * Mutabakat farkı için müdür/admin notu kaydet.
   * Fark varsa açıklama, müşteri fazla ödedi vb. Kilitli günler hariç
   * herkes (mağaza yetkisi olan) güncelleyebilir.
   */
  saveReconciliationNotes: protectedProcedure
    .input(
      z.object({
        store_id: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);

      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: dateObj } },
        select: { id: true, status: true },
      });
      if (!dr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bu gün için kayıt bulunamadı — önce belge yükleyin",
        });
      }
      if (dr.status === "locked" && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli — sadece admin not güncelleyebilir",
        });
      }

      const trimmed = input.notes.trim();
      return ctx.prisma.dailyRecord.update({
        where: { id: dr.id },
        data: {
          reconciliation_notes: trimmed.length > 0 ? trimmed : null,
          reconciliation_notes_by: ctx.user.id,
          reconciliation_notes_at: new Date(),
        },
        select: {
          id: true,
          reconciliation_notes: true,
          reconciliation_notes_at: true,
        },
      });
    }),

  /**
   * Müdür/admin'in günü kapatırken elden saydığı nakit toplamını kaydet.
   * StoreSummary.cash_sales ile karşılaştırılır — fark çıkarsa kasa
   * eksikliği/fazlalığı uyarısı verilir.
   */
  setReportedCash: protectedProcedure
    .input(setReportedCashSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);

      // DailyRecord yoksa oluştur (lazy)
      const dr = await ctx.prisma.dailyRecord.upsert({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        create: {
          store_id: input.store_id,
          date: dateObj,
          status: "draft",
          reported_cash_try: input.amount,
          reported_cash_note: input.note ?? null,
          reported_cash_at: new Date(),
        },
        update: {
          reported_cash_try: input.amount,
          reported_cash_note: input.note ?? null,
          reported_cash_at: new Date(),
        },
      });

      if (dr.status === "locked" && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin değiştirebilir",
        });
      }
      return dr;
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
