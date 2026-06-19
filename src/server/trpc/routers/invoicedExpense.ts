import { TRPCError } from "@trpc/server";
import type { Currency } from "@prisma/client";
import { router, adminProcedure } from "../trpc";
import { parseInvoicedExcel } from "@/server/services/masraf/parse-invoiced";
import { faturaliDagitim, masrafMatrix } from "@/server/services/masraf/dagitim";
import { buildMaviReport } from "@/server/services/masraf/mavi-report";
import { buildMaviMasraflarExcel } from "@/server/services/exports/excel/mavi-masraflar";
import {
  invoicedUploadSchema,
  invoicedBatchIdSchema,
  invoicedUpdateItemSchema,
  invoicedListSchema,
} from "@/lib/zod-schemas/invoiced-expense";

export const invoicedExpenseRouter = router({
  /**
   * Faturalı Masraflar (şirket kartı) Excel yükle → parse + kategorize + FX.
   * Her dolu ay için bir DRAFT batch oluşturur (varolan draft'ı değiştirir;
   * confirmed batch varsa o ayı atlar).
   */
  upload: adminProcedure
    .input(invoicedUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.file_base64, "base64");
      let months;
      try {
        months = await parseInvoicedExcel(buffer);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Excel okunamadı: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
        });
      }
      const withItems = months.filter((m) => m.items.length > 0);
      if (withItems.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Tanınan ay sayfası ya da masraf bulunamadı. Sayfa adları OCAK..ARALIK olmalı.",
        });
      }

      const created: {
        batch_id: string;
        year: number;
        month: number;
        label: string;
        count: number;
        total: number;
        fx_failed: number;
        skipped?: boolean;
      }[] = [];

      for (const m of withItems) {
        const year = new Date(m.items[0].expense_date).getUTCFullYear();

        // Onaylı batch varsa dokunma (kullanıcı bilerek onaylamış)
        const confirmed = await ctx.prisma.invoicedExpenseBatch.findFirst({
          where: { period_year: year, period_month: m.month, status: "confirmed" },
        });
        if (confirmed) {
          created.push({
            batch_id: confirmed.id,
            year,
            month: m.month,
            label: m.month_label,
            count: m.items.length,
            total: m.total_try,
            fx_failed: m.items.filter((i) => i.fx_failed).length,
            skipped: true,
          });
          continue;
        }

        // Varolan draft'ı değiştir (cascade item siler)
        await ctx.prisma.invoicedExpenseBatch.deleteMany({
          where: { period_year: year, period_month: m.month, status: "draft" },
        });

        const batch = await ctx.prisma.invoicedExpenseBatch.create({
          data: {
            period_year: year,
            period_month: m.month,
            source_filename: input.filename,
            status: "draft",
            uploaded_by: ctx.user.id,
            items: {
              create: m.items.map((it) => ({
                expense_date: new Date(`${it.expense_date}T00:00:00.000Z`),
                raw_description: it.raw_description,
                amount_original: it.amount_original,
                currency: it.currency as Currency,
                fx_rate: it.fx_rate,
                fx_rate_date: it.fx_rate_date
                  ? new Date(`${it.fx_rate_date}T00:00:00.000Z`)
                  : null,
                amount_try: it.amount_try,
                category: it.category,
                auto_category: it.auto_category,
                needs_review: it.needs_review,
                belongs_month: it.belongs_month,
              })),
            },
          },
        });

        created.push({
          batch_id: batch.id,
          year,
          month: m.month,
          label: m.month_label,
          count: m.items.length,
          total: m.total_try,
          fx_failed: m.items.filter((i) => i.fx_failed).length,
        });
      }

      return { created };
    }),

  /** Batch listesi (özet) — opsiyonel yıl filtresi. */
  list: adminProcedure.input(invoicedListSchema).query(async ({ ctx, input }) => {
    const batches = await ctx.prisma.invoicedExpenseBatch.findMany({
      where: input.year ? { period_year: input.year } : {},
      orderBy: [{ period_year: "desc" }, { period_month: "desc" }],
      include: {
        items: { select: { amount_try: true, needs_review: true, fx_rate: true } },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      period_year: b.period_year,
      period_month: b.period_month,
      status: b.status,
      source_filename: b.source_filename,
      created_at: b.created_at,
      item_count: b.items.length,
      total_try: b.items.reduce((s, i) => s + Number(i.amount_try), 0),
      review_count: b.items.filter((i) => i.needs_review).length,
    }));
  }),

  /** Bir batch'in tüm satırları. */
  getBatch: adminProcedure
    .input(invoicedBatchIdSchema)
    .query(async ({ ctx, input }) => {
      const batch = await ctx.prisma.invoicedExpenseBatch.findUnique({
        where: { id: input.batch_id },
        include: { items: { orderBy: { expense_date: "asc" } } },
      });
      if (!batch) throw new TRPCError({ code: "NOT_FOUND" });
      return batch;
    }),

  /** Bir satırın kategorisini değiştir (manuel override). */
  updateItem: adminProcedure
    .input(invoicedUpdateItemSchema)
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.prisma.invoicedExpenseItem.findUnique({
        where: { id: input.id },
        include: { batch: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (item.batch.status === "confirmed") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Onaylanmış dönem — kategori değiştirilemez.",
        });
      }
      return ctx.prisma.invoicedExpenseItem.update({
        where: { id: input.id },
        data: { category: input.category, needs_review: false },
      });
    }),

  /** Batch'i onayla (draft → confirmed). */
  confirm: adminProcedure
    .input(invoicedBatchIdSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.invoicedExpenseBatch.update({
        where: { id: input.batch_id },
        data: { status: "confirmed", confirmed_at: new Date() },
      });
    }),

  /** Faturalı masrafın Mavi mağazalarına ÷7 dağıtımı (onaylı dönemler). */
  distribution: adminProcedure
    .input(invoicedListSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return faturaliDagitim(ctx.prisma, year);
    }),

  /** Birleşik Mavi masraf matrisi: faturalı dağıtım + kasa + POS. */
  matrix: adminProcedure
    .input(invoicedListSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return masrafMatrix(ctx.prisma, year);
    }),

  /**
   * "Mavi Masraflar" raporu (Faz 4) — ekran tablosu için şekillendirilmiş matris:
   * sabit satır sırası (oto + manuel), ay/mağaza toplamları, kaynak rozetleri.
   */
  report: adminProcedure
    .input(invoicedListSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return buildMaviReport(ctx.prisma, year);
    }),

  /** "Mavi Masraflar" Excel çıktısı (Dosya 3 formatı) → base64. */
  exportMatrix: adminProcedure
    .input(invoicedListSchema)
    .mutation(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      const report = await buildMaviReport(ctx.prisma, year);
      return buildMaviMasraflarExcel({ report });
    }),

  /** Batch sil. */
  delete: adminProcedure
    .input(invoicedBatchIdSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.invoicedExpenseBatch.delete({
        where: { id: input.batch_id },
      });
      return { ok: true };
    }),
});
