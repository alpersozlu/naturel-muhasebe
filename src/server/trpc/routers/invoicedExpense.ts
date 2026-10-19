import { TRPCError } from "@trpc/server";
import type { Currency } from "@prisma/client";
import { router, adminProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import { parseInvoicedExcel } from "@/server/services/masraf/parse-invoiced";
import { faturaliDagitim, masrafMatrix } from "@/server/services/masraf/dagitim";
import { buildMaviReport } from "@/server/services/masraf/mavi-report";
import { buildMaviMasraflarExcel } from "@/server/services/exports/excel/mavi-masraflar";
import { classifyInvoice, readInvoice, rematchMonth, storeInvoiceFiles } from "@/server/services/masraf/invoices";
import { masrafCashItems } from "@/server/services/masraf/cash-items";
import { createSignedReadUrl, deleteFromStorage } from "@/server/services/storage";
import { categorizeExpense } from "@/lib/masraf/categorize";
import {
  invoicedUploadSchema,
  invoicedBatchIdSchema,
  invoicedUpdateItemSchema,
  invoicedListSchema,
  masrafReportSchema,
  masrafPhotoUploadSchema,
  masrafPhotoIdSchema,
  masrafPhotoListSchema,
  masrafPhotoUpdateSchema,
  masrafPhotoLinkSchema,
  masrafCashItemsSchema,
  masrafCashCategorySchema,
  masrafManualSetSchema,
} from "@/lib/zod-schemas/invoiced-expense";

const photoAudited = withAudit("MasrafInvoice");
const cashAudited = withAudit("MasrafCashCategory");
const manualAudited = withAudit("MasrafManualEntry");

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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

  /** Şirket faturalarının markaya ÷7 dağıtımı. */
  distribution: adminProcedure
    .input(masrafReportSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return faturaliDagitim(ctx.prisma, year, input.brand ?? "mavi");
    }),

  /** Birleşik masraf matrisi (tüm kaynaklar, marka seçimli). */
  matrix: adminProcedure
    .input(masrafReportSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return masrafMatrix(ctx.prisma, year, input.brand ?? "mavi");
    }),

  /** Masraf raporu — ekran tablosu için şekillendirilmiş matris (gruplar, toplamlar, kaynaklar). */
  report: adminProcedure
    .input(masrafReportSchema)
    .query(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      return buildMaviReport(ctx.prisma, year, input.brand ?? "mavi");
    }),

  /** Masraf Excel çıktısı (sahibinin düzeni) → base64. */
  exportMatrix: adminProcedure
    .input(masrafReportSchema)
    .mutation(async ({ ctx, input }) => {
      const year = input.year ?? new Date().getUTCFullYear();
      const report = await buildMaviReport(ctx.prisma, year, input.brand ?? "mavi");
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

  // ───────────────────────────────────────────────────────────────────────
  // FATURA FOTOĞRAFLARI (Faz 7) — sahibi tüm masraf faturalarını fotoğraflar
  // ───────────────────────────────────────────────────────────────────────

  /** Fotoğrafları kaydeder (storage + satır). OCR sonra `photosRead` ile tek tek. */
  photosUpload: photoAudited
    .input(masrafPhotoUploadSchema)
    .mutation(({ ctx, input }) => storeInvoiceFiles(ctx.prisma, input.files, ctx.user.id, input.year, input.month)),

  /** Tek faturanın OCR'ı + eşleştirme + sınıflama. */
  photosRead: photoAudited.input(masrafPhotoIdSchema).mutation(async ({ ctx, input }) => {
    const r = await readInvoice(ctx.prisma, input.id);
    return { id: r.id, ocr_status: r.ocr_status, classification: r.classification, vendor: r.vendor, amount_try: r.amount_try == null ? null : Number(r.amount_try), error: r.ocr_error, category: r.category };
  }),

  /** Ayın fotoğrafları + özet. */
  photosList: adminProcedure.input(masrafPhotoListSchema).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.masrafInvoice.findMany({
      where: { period_year: input.year, period_month: input.month, deleted_at: null },
      orderBy: [{ expense_date: "asc" }, { uploaded_at: "asc" }],
      include: {
        matched_expense: { select: { id: true, expense_date: true, amount_try: true, vendor: true, category: true, description: true, daily_record: { select: { date: true, store_id: true, store: { select: { name: true } } } } } },
      },
    });
    const dupOf = new Map(rows.map((r) => [r.id, r]));
    const storeCount = (await ctx.prisma.store.count({ where: { deleted_at: null } })) || 7;
    const list = rows.map((r) => {
      const amt = r.amount_try == null ? null : Number(r.amount_try);
      const twin = r.duplicate_of_id ? dupOf.get(r.duplicate_of_id) : null;
      return {
        id: r.id,
        source_name: r.source_name,
        mime_type: r.mime_type,
        uploaded_at: r.uploaded_at.toISOString(),
        ocr_status: r.ocr_status,
        ocr_error: r.ocr_error,
        vendor: r.vendor,
        document_no: r.document_no,
        expense_date: iso(r.expense_date),
        amount_original: r.amount_original == null ? null : Number(r.amount_original),
        currency: r.currency,
        amount_try: amt,
        description: r.description,
        ocr_category: r.ocr_category,
        category: r.category,
        auto_category: r.auto_category,
        needs_review: r.needs_review,
        belongs_month: r.belongs_month,
        classification: r.classification,
        decided: !!r.decided_by,
        decision_note: r.decision_note,
        match_method: r.match_method,
        match_score: r.match_score == null ? null : Number(r.match_score),
        matched: r.matched_expense
          ? {
              id: r.matched_expense.id,
              store_name: r.matched_expense.daily_record.store.name,
              store_id: r.matched_expense.daily_record.store_id,
              date: iso(r.matched_expense.daily_record.date)!,
              amount_try: Number(r.matched_expense.amount_try),
              vendor: r.matched_expense.vendor,
              category: r.matched_expense.category,
              description: r.matched_expense.description,
            }
          : null,
        duplicate_of: twin ? { id: twin.id, vendor: twin.vendor, amount_try: twin.amount_try == null ? null : Number(twin.amount_try) } : null,
        per_store: r.classification === "company" && amt != null ? Math.round((amt / storeCount) * 100) / 100 : null,
      };
    });
    const sum = (f: (x: (typeof list)[number]) => boolean) => list.filter(f).reduce((s, x) => s + (x.amount_try ?? 0), 0);
    return {
      store_count: storeCount,
      items: list,
      summary: {
        total: list.length,
        pending: list.filter((x) => x.ocr_status === "pending").length,
        failed: list.filter((x) => x.ocr_status === "failed").length,
        company: list.filter((x) => x.classification === "company").length,
        company_total: sum((x) => x.classification === "company"),
        store: list.filter((x) => x.classification === "store").length,
        store_total: sum((x) => x.classification === "store"),
        duplicate: list.filter((x) => x.classification === "duplicate").length,
        excluded: list.filter((x) => x.classification === "excluded").length,
        review: list.filter((x) => x.needs_review && x.ocr_status === "done").length,
      },
    };
  }),

  /** Fotoğrafı görüntüle (imzalı URL, 1 saat). */
  photoUrl: adminProcedure.input(masrafPhotoIdSchema).query(async ({ ctx, input }) => {
    const r = await ctx.prisma.masrafInvoice.findUniqueOrThrow({ where: { id: input.id }, select: { storage_path: true, mime_type: true } });
    return { url: await createSignedReadUrl(r.storage_path, 3600), mime_type: r.mime_type };
  }),

  /** Yönetici düzeltmesi: kategori / sınıf (şirket say, çıkar, otomatiğe bırak) / ay / tutar / satıcı / tarih. */
  photosUpdate: photoAudited.input(masrafPhotoUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, classification, note, ...rest } = input;
    const inv = await ctx.prisma.masrafInvoice.findUniqueOrThrow({ where: { id } });
    const data: Record<string, unknown> = {};
    if (rest.category !== undefined) data.category = rest.category;
    if (rest.period_month !== undefined) data.period_month = rest.period_month;
    if (rest.period_year !== undefined) data.period_year = rest.period_year;
    if (rest.amount_try !== undefined) data.amount_try = rest.amount_try;
    if (rest.vendor !== undefined) data.vendor = rest.vendor;
    if (rest.expense_date !== undefined) data.expense_date = new Date(`${rest.expense_date}T00:00:00.000Z`);
    if (rest.belongs_month !== undefined) data.belongs_month = rest.belongs_month;
    if (note !== undefined) data.decision_note = note;
    if (rest.category !== undefined || rest.amount_try !== undefined) data.needs_review = false;
    if (classification === "pending") {
      // otomatiğe bırak → yeniden eşleştir
      await ctx.prisma.masrafInvoice.update({ where: { id }, data: { ...data, decided_by: null, decision_note: note ?? null } });
      return classifyInvoice(ctx.prisma, id, { force: true });
    }
    if (classification) {
      data.classification = classification;
      data.decided_by = ctx.user.id;
      data.matched_expense_id = null;
      data.match_method = "manual";
      data.match_score = null;
      data.duplicate_of_id = null;
      if (inv.ocr_status !== "done" && classification === "company") {
        // okunamayan ama elle tutarı girilen fatura şirket faturası sayılabilir
        if (rest.amount_try === undefined && inv.amount_try == null) throw new TRPCError({ code: "BAD_REQUEST", message: "Önce tutarı gir." });
        data.ocr_status = "done";
        data.ocr_error = null;
        data.category = rest.category ?? inv.category ?? categorizeExpense({ category: inv.ocr_category, vendor: rest.vendor ?? inv.vendor, description: inv.description }).category;
      }
    }
    return ctx.prisma.masrafInvoice.update({ where: { id }, data });
  }),

  /** Fotoğrafı mağazanın bir masraf kaydına elle bağla (mağaza faturası). */
  photosLink: photoAudited.input(masrafPhotoLinkSchema).mutation(async ({ ctx, input }) => {
    const ex = await ctx.prisma.expense.findUnique({ where: { id: input.expense_id }, select: { id: true } });
    if (!ex) throw new TRPCError({ code: "NOT_FOUND", message: "Masraf kaydı bulunamadı" });
    const other = await ctx.prisma.masrafInvoice.findFirst({ where: { matched_expense_id: ex.id, deleted_at: null, id: { not: input.id } }, select: { id: true } });
    if (other) throw new TRPCError({ code: "CONFLICT", message: "Bu masraf kaydına başka bir fotoğraf zaten bağlı." });
    return ctx.prisma.masrafInvoice.update({
      where: { id: input.id },
      data: { classification: "store", matched_expense_id: ex.id, match_method: "manual", match_score: 1, duplicate_of_id: null, decided_by: ctx.user.id, ocr_status: "done", ocr_error: null },
    });
  }),

  /** Mağazanın o aya yakın masraf kayıtları (elle bağlama için aday listesi). */
  photosCandidates: adminProcedure.input(masrafPhotoIdSchema).query(async ({ ctx, input }) => {
    const inv = await ctx.prisma.masrafInvoice.findUniqueOrThrow({ where: { id: input.id } });
    const from = new Date(Date.UTC(inv.period_year, inv.period_month - 2, 1));
    const to = new Date(Date.UTC(inv.period_year, inv.period_month + 1, 1));
    const rows = await ctx.prisma.expense.findMany({
      where: { expense_date: { gte: from, lt: to } },
      select: { id: true, vendor: true, amount_try: true, expense_date: true, document_no: true, description: true, daily_record: { select: { store: { select: { name: true } } } }, masraf_invoices: { where: { deleted_at: null }, select: { id: true } } },
      orderBy: { expense_date: "desc" },
    });
    const amt = inv.amount_try == null ? null : Number(inv.amount_try);
    return rows
      .map((r) => ({ id: r.id, store_name: r.daily_record.store.name, vendor: r.vendor, amount_try: Number(r.amount_try), date: iso(r.expense_date)!, document_no: r.document_no, description: r.description, taken: r.masraf_invoices.length > 0 }))
      .sort((a, b) => (amt == null ? 0 : Math.abs(a.amount_try - amt) - Math.abs(b.amount_try - amt)) || b.date.localeCompare(a.date))
      .slice(0, 60);
  }),

  /** Fotoğrafı kaldır (yumuşak silme; dosya kalır). */
  photosDelete: photoAudited.input(masrafPhotoIdSchema).mutation(async ({ ctx, input }) => {
    const r = await ctx.prisma.masrafInvoice.update({ where: { id: input.id }, data: { deleted_at: new Date(), matched_expense_id: null } });
    void deleteFromStorage; // dosya saklanır (denetim izi); gerekirse burada silinir
    return { id: r.id };
  }),

  /** Ayın fotoğraflarını yeniden eşleştir (mağaza sonradan yüklediyse). */
  photosRematch: photoAudited.input(masrafPhotoListSchema).mutation(({ ctx, input }) => rematchMonth(ctx.prisma, input.year, input.month)),

  /** Okunamayan / bekleyen fotoğrafları yeniden oku. */
  photosRetry: photoAudited.input(masrafPhotoIdSchema).mutation(async ({ ctx, input }) => {
    await ctx.prisma.masrafInvoice.update({ where: { id: input.id }, data: { ocr_status: "pending", ocr_error: null, decided_by: null } });
    const r = await readInvoice(ctx.prisma, input.id);
    return { id: r.id, ocr_status: r.ocr_status, classification: r.classification, error: r.ocr_error };
  }),

  // ───────────────────────────────────────────────────────────────────────
  // KASA KALEMLERİ — mağaza fişleri + faturasız peşin ödemeler, satır düzeltme
  // ───────────────────────────────────────────────────────────────────────
  cashItems: adminProcedure.input(masrafCashItemsSchema).query(({ ctx, input }) => masrafCashItems(ctx.prisma, input.year, input.month, input.brand ?? "mavi")),

  setCashCategory: cashAudited.input(masrafCashCategorySchema).mutation(async ({ ctx, input }) => {
    if (input.source === "expense") {
      const r = await ctx.prisma.expense.update({ where: { id: input.id }, data: { masraf_category: input.category } });
      return { id: r.id, source: input.source, category: r.masraf_category };
    }
    const r = await ctx.prisma.cashAdvance.update({ where: { id: input.id }, data: { masraf_category: input.category } });
    return { id: r.id, source: input.source, category: r.masraf_category };
  }),

  // ───────────────────────────────────────────────────────────────────────
  // ELLE GİRİLEN HÜCRELER
  // ───────────────────────────────────────────────────────────────────────
  manualSet: manualAudited.input(masrafManualSetSchema).mutation(async ({ ctx, input }) => {
    const where = { brand_period_year_period_month_store_code_row_key: { brand: input.brand, period_year: input.year, period_month: input.month, store_code: input.store_code, row_key: input.row_key } };
    if (input.amount_try === 0) {
      await ctx.prisma.masrafManualEntry.deleteMany({ where: { brand: input.brand, period_year: input.year, period_month: input.month, store_code: input.store_code, row_key: input.row_key } });
      return { id: `${input.store_code}:${input.row_key}`, deleted: true };
    }
    const r = await ctx.prisma.masrafManualEntry.upsert({
      where,
      create: { brand: input.brand, period_year: input.year, period_month: input.month, store_code: input.store_code, row_key: input.row_key, amount_try: input.amount_try, note: input.note ?? null, updated_by: ctx.user.id },
      update: { amount_try: input.amount_try, note: input.note ?? null, updated_by: ctx.user.id },
    });
    return { id: r.id, amount_try: Number(r.amount_try) };
  }),

  manualList: adminProcedure.input(masrafReportSchema).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.masrafManualEntry.findMany({ where: { brand: input.brand ?? "mavi", period_year: input.year ?? new Date().getUTCFullYear() } });
    return rows.map((r) => ({ month: r.period_month, store_code: r.store_code, row_key: r.row_key, amount_try: Number(r.amount_try), note: r.note }));
  }),
});
