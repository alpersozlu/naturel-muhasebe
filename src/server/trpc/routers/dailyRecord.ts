import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import {
  dailyRecordIdSchema,
  setReportedCashSchema,
  setGiftVoucherSchema,
  setMaviGiftVoucherSchema,
  setCumulativePrevSchema,
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
  /**
   * Sadece DOĞRULAMA — verification kaydı oluşturur, status'u 'approved' yapar.
   * Kilitlemez (locked değil) — müdür/admin /upload sayfasından kullanabilir.
   * Kilit için ayrı /verification sayfasında admin `approveAndLock` çağırır.
   */
  approve: dailyAdmin
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
      if (dr.status === "locked") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün zaten kilitli — admin Doğrulama Sistemi'nden açabilir",
        });
      }

      const result = await computeDay(ctx.prisma, input.id);
      await persistVerification(ctx.prisma, input.id, result);

      return ctx.prisma.dailyRecord.update({
        where: { id: input.id },
        data: {
          status: "approved",
          approved_by: ctx.user.id,
          approved_at: new Date(),
        },
        include: { verification: true },
      });
    }),

  approveAndLock: dailyAdmin
    .input(dailyRecordIdSchema)
    .mutation(async ({ ctx, input }) => {
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { id: input.id },
        include: {
          store_summary: true,
          dealer_daily_report: true,
          store: { include: { brand: true } },
        },
      });
      if (!dr) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanAccessStore(ctx.user, dr.store_id);

      if (!isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Kilitleme sadece admin yetkisinde (Doğrulama Sistemi)",
        });
      }
      if (!dr.store_summary) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Mağaza Özeti yüklenmeden gün onaylanamaz",
        });
      }

      // ── 3. Aşama: SAP Bayi Raporu kontrolü (Mavi mağazalar için zorunlu) ──
      const brandLower = dr.store.brand.name.toLocaleLowerCase("tr");
      const isMaviBrand = brandLower.includes("mavi");
      if (isMaviBrand) {
        if (!dr.dealer_daily_report) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "3. Aşama eksik: Bayi Gün Sonu (SAP) yüklenmemiş. Mavi mağazalarda SAP raporu kontrolü zorunlu — yüklemeden gün kilitlenemez.",
          });
        }
        const TOL = 5;
        const sapNet = dr.dealer_daily_report.net_sales_try?.toNumber() ?? 0;
        const sapLoy = dr.dealer_daily_report.loyalty_try?.toNumber() ?? 0;
        const sumNet = dr.store_summary.sales_total_try?.toNumber() ?? 0;
        const sumLoy = dr.store_summary.loyalty_points_total_try?.toNumber() ?? 0;
        const netDiff = sapNet - sumNet;
        const loyDiff = sapLoy - sumLoy;
        if (Math.abs(netDiff) > TOL || Math.abs(loyDiff) > TOL) {
          const fmt = (n: number) =>
            n.toLocaleString("tr-TR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          const parts: string[] = [];
          if (Math.abs(netDiff) > TOL) {
            parts.push(
              `Net Satış SAP=${fmt(sapNet)} ↔ Özet=${fmt(sumNet)} (fark ${fmt(netDiff)})`
            );
          }
          if (Math.abs(loyDiff) > TOL) {
            parts.push(
              `Kartuş SAP=${fmt(sapLoy)} ↔ Özet=${fmt(sumLoy)} (fark ${fmt(loyDiff)})`
            );
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `3. Aşama uyumsuz: SAP Bayi Raporu Mağaza Özeti'nden farklı. ${parts.join(" · ")}. Manipülasyon riski — kilitleme reddedildi.`,
          });
        }
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
          expenses: { select: { id: true } },
          cash_advances: { select: { id: true } },
          merge_group: {
            include: {
              daily_records: {
                orderBy: { date: "asc" },
                select: { id: true, date: true, merge_index: true },
              },
            },
          },
          cumulative_prev: {
            select: { date: true, store_summary: { select: { id: true } } },
          },
        },
      });

      if (!dr) {
        return {
          exists: false,
          status: "empty" as const,
          has_z: false,
          has_z_report: false,
          has_manual_invoice: false,
          has_summary: false,
          pos_count: 0,
          has_reported_cash: false,
          has_bank_receipt: false,
          has_gift_voucher: false,
          has_expenses: false,
          gift_voucher_total: 0,
          requires_cash_proof: false,
          manual_invoice_count: 0,
          failed_count: 0,
          daily_record_status: null,
          daily_record_id: null,
          reconciliation_notes: null,
          reconciliation_notes_at: null,
          merge: null,
          verification: null,
          nebim_summary: null,
        };
      }

      // Gün birleşmesi: grup varsa checklist flag'leri TÜM günler boyunca.
      // Mağaza özeti grubun son gününde olur; uzlaşma o gün üzerinden hesaplanır.
      const groupRecords = dr.merge_group_id
        ? await ctx.prisma.dailyRecord.findMany({
            where: { merge_group_id: dr.merge_group_id },
            orderBy: { date: "asc" },
            include: {
              store_summary: true,
              z_reports: { select: { id: true } },
              pos_slips: {
                select: { id: true, upload: { select: { status: true } } },
              },
              bank_receipts: { select: { id: true } },
              manual_invoices: { select: { id: true } },
              expenses: { select: { id: true } },
              cash_advances: { select: { id: true } },
            },
          })
        : null;

      // Agregasyon kaynağı: grup varsa tüm günler, yoksa sadece bu gün.
      const agg = groupRecords ?? [dr];

      // "Z" = Z raporu fişi VEYA el faturası (ya da ikisi). Toplam Z = ikisinin toplamı.
      const hasZReport = agg.some((r) => r.z_reports.length > 0);
      const hasManualInvoice = agg.some((r) => r.manual_invoices.length > 0);
      const hasZ = hasZReport || hasManualInvoice;
      // Özet: grup varsa son günde (herhangi biri dolu), tek günde kendi günü
      const summaryRec = agg.find((r) => r.store_summary !== null);
      const hasSummary = !!summaryRec;
      const posCount = agg
        .flatMap((r) => r.pos_slips)
        .filter(
          (p) => p.upload.status === "parsed" || p.upload.status === "confirmed"
        ).length;
      const hasReportedCash = agg.some((r) => r.reported_cash_try !== null);
      // Dekont nakit kaynağı sayılır mı? Havale ayrı kalem ise sayılmaz.
      const summaryWire =
        summaryRec?.store_summary?.wire_transfer_total_try?.toNumber() ?? 0;
      const wireIsSeparate = summaryWire > 5;
      const hasBankReceipt =
        agg.some((r) => r.bank_receipts.length > 0) && !wireIsSeparate;
      const giftVoucherTotal = agg.reduce(
        (s, r) => s + (r.gift_voucher_try?.toNumber() ?? 0),
        0
      );
      const hasGiftVoucher = giftVoucherTotal > 0;
      const hasExpenses = agg.some(
        (r) => r.expenses.length > 0 || r.cash_advances.length > 0
      );
      const failedCount = dr.uploads.filter((u) => u.status === "failed").length;
      // Mağaza özeti nakit > 0 ise dekont/sayım gerekli; 0 ise POS-only gün, gerekmez
      const cashSales =
        summaryRec?.store_summary?.cash_sales_try?.toNumber() ?? 0;
      const requiresCashProof = hasSummary && cashSales > 0.01;

      // Mutabakat — özetin bulunduğu gün üzerinden (merge'de son gün).
      // computeDay merge-aware: grup varsa tüm günleri toplar.
      const computeRecordId = summaryRec?.id ?? dr.id;
      const verification = hasSummary
        ? await computeDay(ctx.prisma, computeRecordId)
        : null;

      // NEBİM canlı server karşılaştırması (3. kontrol aşaması — Derimod).
      // Bu mağaza+gün(ler) için Nebim'e kaydedilen net satış toplamı. İade
      // satırları (is_return) düşülür. Nebim verisi yoksa (örn. Mavi) null.
      const nebimLines = await ctx.prisma.nebimSaleLine.findMany({
        where: {
          store_id: input.store_id,
          invoice_date: { in: agg.map((r) => r.date) },
        },
        select: { net_amount: true, is_return: true, invoice_ref: true },
      });
      let nebimSummary: {
        net: number;
        sales: number;
        returns: number;
        line_count: number;
        invoice_count: number;
        summary_sales: number;
        difference: number;
      } | null = null;
      if (nebimLines.length > 0) {
        let sales = 0;
        let returns = 0;
        const invoices = new Set<string>();
        for (const l of nebimLines) {
          const amt = l.net_amount?.toNumber() ?? 0;
          if (l.is_return) returns += amt;
          else sales += amt;
          invoices.add(l.invoice_ref);
        }
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const net = r2(sales - returns);
        const summarySales =
          summaryRec?.store_summary?.sales_total_try?.toNumber() ?? 0;
        nebimSummary = {
          net,
          sales: r2(sales),
          returns: r2(returns),
          line_count: nebimLines.length,
          invoice_count: invoices.size,
          summary_sales: r2(summarySales),
          difference: r2(net - summarySales),
        };
      }

      let status:
        | "empty"
        | "incomplete"
        | "ready"
        | "match"
        | "mismatch"
        | "locked"
        | "error";
      // Özette nakit > 0 ise nakit kaynağı (sayım/dekont/hediye/masraf) zorunlu
      const cashSourceMissing =
        requiresCashProof &&
        !hasReportedCash &&
        !hasBankReceipt &&
        !hasGiftVoucher &&
        !hasExpenses;

      if (dr.status === "locked") status = "locked";
      else if (failedCount > 0) status = "error";
      else if (!hasSummary || !hasZ || posCount === 0 || cashSourceMissing)
        status = "incomplete";
      else if (!verification) status = "ready";
      else if (verification.status === "match") status = "match";
      else status = "mismatch";

      return {
        exists: true,
        status,
        has_z: hasZ,
        has_z_report: hasZReport,
        has_manual_invoice: hasManualInvoice,
        has_summary: hasSummary,
        pos_count: posCount,
        has_reported_cash: hasReportedCash,
        has_bank_receipt: hasBankReceipt,
        has_gift_voucher: hasGiftVoucher,
        has_expenses: hasExpenses,
        gift_voucher_total: giftVoucherTotal,
        requires_cash_proof: requiresCashProof,
        manual_invoice_count: dr.manual_invoices.length,
        failed_count: failedCount,
        daily_record_status: dr.status,
        daily_record_id: dr.id,
        reconciliation_notes: dr.reconciliation_notes,
        reconciliation_notes_at: dr.reconciliation_notes_at,
        nebim_summary: nebimSummary,
        // Gün birleşmesi bağlamı (varsa) — panel grup bilgisini gösterir
        merge: dr.merge_group
          ? {
              group_id: dr.merge_group.id,
              start_date: dr.merge_group.start_date.toISOString().slice(0, 10),
              end_date: dr.merge_group.end_date.toISOString().slice(0, 10),
              day_count: dr.merge_group.daily_records.length,
              this_index: dr.merge_index ?? null,
              is_last_day: summaryRec?.id === dr.id || dr.merge_index === dr.merge_group.daily_records.length,
            }
          : null,
        // Kümülatif kasa birleşmesi (Mavi) — özet bu günden önceki günü içerir
        cumulative: dr.cumulative_prev_id
          ? {
              prev_date:
                dr.cumulative_prev?.date.toISOString().slice(0, 10) ?? null,
              prev_has_summary: !!dr.cumulative_prev?.store_summary,
            }
          : null,
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

  /** Mevcut hediye çeki girişini oku. */
  getGiftVoucher: protectedProcedure
    .input(setGiftVoucherSchema.pick({ store_id: true, date: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        select: {
          gift_voucher_try: true,
          gift_voucher_note: true,
          gift_voucher_at: true,
        },
      });
      return dr;
    }),

  /**
   * Gün için hediye çeki toplamı (manuel giriş — kullanıcı dosya yüklemez).
   * Nakit denkleminde: hediye + masraf + (sayım + dekont) = StoreSummary.cash_sales
   */
  setGiftVoucher: protectedProcedure
    .input(setGiftVoucherSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);

      const dr = await ctx.prisma.dailyRecord.upsert({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        create: {
          store_id: input.store_id,
          date: dateObj,
          status: "draft",
          gift_voucher_try: input.amount,
          gift_voucher_note: input.note ?? null,
          gift_voucher_at: new Date(),
        },
        update: {
          gift_voucher_try: input.amount,
          gift_voucher_note: input.note ?? null,
          gift_voucher_at: new Date(),
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

  /** Mevcut Mavi Hediye Çeki girişini oku (Derimod). */
  getMaviGiftVoucher: protectedProcedure
    .input(setMaviGiftVoucherSchema.pick({ store_id: true, date: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        select: {
          mavi_gift_voucher_try: true,
          mavi_gift_voucher_note: true,
          mavi_gift_voucher_at: true,
        },
      });
      return dr;
    }),

  /**
   * Mavi Hediye Çeki (Derimod'da kullanılan) — kasa ile alakasız, istatistik.
   * Mavi'de yüksek alışveriş yapan müşterilere verilen, Derimod'da kullanılan
   * hediye çekleri. Gün başına manuel toplam tutar.
   */
  setMaviGiftVoucher: protectedProcedure
    .input(setMaviGiftVoucherSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);

      const dr = await ctx.prisma.dailyRecord.upsert({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        create: {
          store_id: input.store_id,
          date: dateObj,
          status: "draft",
          mavi_gift_voucher_try: input.amount,
          mavi_gift_voucher_note: input.note ?? null,
          mavi_gift_voucher_at: new Date(),
        },
        update: {
          mavi_gift_voucher_try: input.amount,
          mavi_gift_voucher_note: input.note ?? null,
          mavi_gift_voucher_at: new Date(),
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

  /** Mevcut kümülatif kasa birleşmesi bağlamını oku (Mavi). */
  getCumulativePrev: protectedProcedure
    .input(setCumulativePrevSchema.pick({ store_id: true, date: true }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: dateObj } },
        select: {
          cumulative_prev_id: true,
          cumulative_prev: { select: { date: true } },
        },
      });
      if (!dr?.cumulative_prev_id) return null;
      return {
        prev_id: dr.cumulative_prev_id,
        prev_date: dr.cumulative_prev?.date.toISOString().slice(0, 10) ?? null,
      };
    }),

  /**
   * Kümülatif kasa birleşmesi ayarla (Mavi). Bu günün özeti kümülatiftir
   * (önceki günün satışlarını da içerir). Gerçek bugün = bu özet − önceki gün
   * özeti. prev_date önceki bir gün olmalı ve mağaza özeti yüklenmiş olmalı.
   */
  setCumulativePrev: protectedProcedure
    .input(setCumulativePrevSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      if (input.prev_date >= input.date) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Birleşilen gün, bu günden ÖNCE olmalı.",
        });
      }
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const prevObj = new Date(`${input.prev_date}T00:00:00.000Z`);

      const prev = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: prevObj } },
        include: { store_summary: { select: { id: true, sales_total_try: true } } },
      });
      if (!prev || !prev.store_summary) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${input.prev_date} için mağaza özeti bulunamadı. Önce o günü (mağaza özetiyle) yükleyin.`,
        });
      }

      // Bu günü oluştur/güncelle, cumulative_prev'i bağla
      const dr = await ctx.prisma.dailyRecord.upsert({
        where: {
          store_id_date: { store_id: input.store_id, date: dateObj },
        },
        create: {
          store_id: input.store_id,
          date: dateObj,
          status: "draft",
          cumulative_prev_id: prev.id,
        },
        update: { cumulative_prev_id: prev.id },
      });
      if (dr.status === "locked" && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin değiştirebilir",
        });
      }
      return dr;
    }),

  /** Kümülatif kasa birleşmesini kaldır (Mavi). */
  clearCumulativePrev: protectedProcedure
    .input(setCumulativePrevSchema.pick({ store_id: true, date: true }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const dateObj = new Date(`${input.date}T00:00:00.000Z`);
      const dr = await ctx.prisma.dailyRecord.findUnique({
        where: { store_id_date: { store_id: input.store_id, date: dateObj } },
        select: { id: true, status: true },
      });
      if (!dr) return { ok: true };
      if (dr.status === "locked" && !isAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gün kilitli, yalnızca admin değiştirebilir",
        });
      }
      await ctx.prisma.dailyRecord.update({
        where: { id: dr.id },
        data: { cumulative_prev_id: null },
      });
      return { ok: true };
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
