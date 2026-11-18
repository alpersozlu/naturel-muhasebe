import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { withAudit, withAuditProtected } from "../middleware/audit";
import {
  giftVoucherClaimInputSchema,
  giftVoucherIdSchema,
  giftVoucherListSchema,
  giftVoucherOverrideSchema,
} from "@/lib/zod-schemas/gift-voucher";
import { cleanReceiptRef, previewClaim, recheckPending } from "@/server/services/gift-voucher/check";
import { giftVoucherAudit, giftVoucherSummaryMatch } from "@/server/services/gift-voucher/summary-match";
import { assertCanAccessStore, isAdmin } from "@/lib/auth/permissions";
import type { PrismaClient } from "@prisma/client";
import { getOrCreateDailyRecord } from "@/server/services/daily-record";
type PrismaContext = PrismaClient;
import { z } from "zod";

const claimAudited = withAudit("GiftVoucherClaim");
/**
 * Mağaza kullanıcısı da çek KAYDEDEBİLİR (sahibi, 18.11.2026 — Derimod
 * Lefkoşa'da "FORBIDDEN"): okutma kutusu Yükle ve Analiz'deki günlük karta
 * taşındığında kaydetme hâlâ yalnız yöneticiye açıktı. Yetki prosedürde:
 * yönetici olmayan yalnız ERİŞEBİLDİĞİ mağazaya kaydeder.
 */
const claimAuditedStore = withAuditProtected("GiftVoucherClaim");

/**
 * O günün okutulmuş çek toplamını DailyRecord'a yazar (Mavi Hediye Çeki —
 * yalnız istatistik, kasayı etkilemez). Gün kilitliyse dokunmaz.
 */
async function syncDayTotal(prisma: PrismaContext, storeId: string, dateIso: string): Promise<void> {
  const day = new Date(`${dateIso}T00:00:00.000Z`);
  // Gün kaydı henüz yoksa açılır (diğer kartlardaki davranış); "satış olmadı"
  // diye kapatılmış güne çek yazılmaz, getOrCreateDailyRecord reddeder.
  const dr = await getOrCreateDailyRecord(prisma, storeId, dateIso);
  if (dr.status === "locked") return;
  const g = await prisma.giftVoucherClaim.aggregate({
    where: { used_store_id: storeId, used_date: day },
    _sum: { amount: true },
    _count: true,
  });
  await prisma.dailyRecord.update({
    where: { id: dr.id },
    data: {
      mavi_gift_voucher_try: num(g._sum.amount),
      mavi_gift_voucher_note: `${g._count} çek okutuldu`,
      mavi_gift_voucher_at: new Date(),
    },
  });
}
const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * HEDİYE ÇEKİ KONTROLÜ (sahibi, 16.11.2026).
 * Çek Nebim'de zaten indirim olarak düşer; burası SONRADAN denetimdir.
 */
export const giftVoucherRouter = router({
  /** Okutulan çek + fiş için kararı hesapla (kaydetmeden). */
  preview: protectedProcedure.input(giftVoucherClaimInputSchema).query(async ({ ctx, input }) => {
    if (input.used_store_id && !isAdmin(ctx.user)) await assertCanAccessStore(ctx.user, input.used_store_id);
    return previewClaim(ctx.prisma, { ...input, used_date: input.used_date ?? todayIso() });
  }),

  /** Kararı kaydet. Aynı çek barkodu ikinci kez kaydedilemez. */
  claim: claimAuditedStore.input(giftVoucherClaimInputSchema).mutation(async ({ ctx, input }) => {
    if (!isAdmin(ctx.user)) {
      if (!input.used_store_id)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Çekin kullanıldığı mağaza seçilmedi." });
      await assertCanAccessStore(ctx.user, input.used_store_id);
    }
    const usedDate = input.used_date ?? todayIso();
    const p = await previewClaim(ctx.prisma, { ...input, used_date: usedDate });
    if (!p.voucher) {
      throw new TRPCError({ code: "BAD_REQUEST", message: p.barcode_error ?? "Çek barkodu okunamadı." });
    }
    // Barkodlu çek iki kez kaydedilemez. Barkodsuz eski çekte böyle bir
    // kimlik yok; aynı fişe aynı tutarın ikinci kez bağlanması engellenir.
    if (p.voucher.barcode) {
      const dup = await ctx.prisma.giftVoucherClaim.findFirst({ where: { barcode: p.voucher.barcode } });
      if (dup) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Bu çek (${p.voucher.barcode}) zaten ${iso(dup.created_at)} tarihinde kaydedilmiş.`,
        });
      }
    } else if (p.receipt) {
      const dup = await ctx.prisma.giftVoucherClaim.findFirst({
        where: { mavi_receipt_id: p.receipt.id, is_manual: true, amount: p.voucher.amount },
      });
      if (dup) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Bu fişe aynı tutarda barkodsuz bir çek zaten kaydedilmiş (${iso(dup.created_at)}).`,
        });
      }
    }
    const created = await ctx.prisma.giftVoucherClaim.create({
      data: {
        barcode: p.voucher.barcode,
        is_manual: p.voucher.manual,
        amount: p.voucher.amount,
        receipt_ref: p.receipt?.ref ?? cleanReceiptRef(input.receipt_ref),
        mavi_receipt_id: p.receipt?.id ?? null,
        used_date: new Date(`${usedDate}T00:00:00.000Z`),
        used_store_id: input.used_store_id ?? null,
        customer_name: input.customer_name ?? null,
        status: p.check.status,
        reasons: p.check.reasons,
        entered_by: ctx.user.id,
        entered_by_name: ctx.user.full_name ?? ctx.user.email,
      },
    });
    // Günün Mavi hediye çeki toplamı artık ELLE yazılmıyor (sahibi,
    // 16.11.2026): okutulan çeklerden hesaplanıp güne yazılır.
    if (input.used_store_id) await syncDayTotal(ctx.prisma, input.used_store_id, usedDate);
    return created;
  }),

  list: protectedProcedure.input(giftVoucherListSchema).query(async ({ ctx, input }) => {
    // Mağaza kullanıcısı yalnız kendi mağazasının çeklerini görür (müşteri adı,
    // fiş tutarı başka mağazaya gösterilmez).
    if (!isAdmin(ctx.user)) {
      if (!input.store_id) throw new TRPCError({ code: "FORBIDDEN", message: "Mağaza seçilmedi." });
      await assertCanAccessStore(ctx.user, input.store_id);
    }
    const rows = await ctx.prisma.giftVoucherClaim.findMany({
      where: {
        ...(input.store_id ? { used_store_id: input.store_id } : {}),
        ...(input.status === "all" ? {} : { status: input.status }),
        ...(input.from || input.to
          ? {
              used_date: {
                ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
                ...(input.to ? { lte: new Date(`${input.to}T00:00:00.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { created_at: "desc" },
      take: input.limit,
      include: {
        mavi_receipt: { include: { store: { select: { name: true } } } },
        used_store: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      is_manual: r.is_manual,
      amount: num(r.amount),
      receipt_ref: r.receipt_ref,
      receipt: r.mavi_receipt
        ? {
            store_name: r.mavi_receipt.store.name,
            date: iso(r.mavi_receipt.date),
            net_amount: num(r.mavi_receipt.net_amount),
          }
        : null,
      used_date: r.used_date ? iso(r.used_date) : null,
      used_store: r.used_store?.name ?? null,
      customer_name: r.customer_name,
      status: r.status as "ok" | "pending" | "fail",
      reasons: r.reasons,
      overridden_at: r.overridden_at,
      override_note: r.override_note,
      entered_by_name: r.entered_by_name,
      created_at: r.created_at,
    }));
  }),

  /**
   * Bir Derimod mağazasının o günkü okutulmuş çek toplamı (Mavi Hediye Çeki
   * kartı) ve mağaza özetindeki "Hediye Çeki" satırıyla mutabakatı.
   */
  dayTotal: protectedProcedure
    .input(z.object({ store_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      await assertCanAccessStore(ctx.user, input.store_id);
      const day = new Date(`${input.date}T00:00:00.000Z`);
      const g = await ctx.prisma.giftVoucherClaim.aggregate({
        where: { used_store_id: input.store_id, used_date: day },
        _sum: { amount: true },
        _count: true,
      });
      const match = await giftVoucherSummaryMatch(ctx.prisma, input.store_id, input.date);
      return { total: num(g._sum.amount), count: g._count, match };
    }),

  /**
   * Günler arası denetim: özetle okutulan çeklerin tutmadığı Derimod günleri
   * (sahibi, 17.11.2026 — "hangi günlerde tutmuyor" tek listede).
   */
  summaryAudit: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(400).default(60) }))
    .query(({ ctx, input }) => {
      const to = todayIso();
      const d = new Date(`${to}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - (input.days - 1));
      return giftVoucherAudit(ctx.prisma, { from: iso(d), to });
    }),

  counts: adminProcedure.query(async ({ ctx }) => {
    const g = await ctx.prisma.giftVoucherClaim.groupBy({ by: ["status"], _count: true, _sum: { amount: true } });
    const out = { ok: 0, pending: 0, fail: 0, total_amount: 0 };
    for (const r of g) {
      if (r.status in out) out[r.status as "ok" | "pending" | "fail"] = r._count;
      out.total_amount += num(r._sum.amount);
    }
    return out;
  }),

  /** Bekleyenleri yeniden kontrol et (Mavi dosyası geldikten sonra). */
  recheck: claimAudited.mutation(({ ctx }) => recheckPending(ctx.prisma)),

  /** Yönetici "ben kabul ettim" der: kayıt uygunsuz kalır ama onaylı işaretlenir. */
  override: claimAudited.input(giftVoucherOverrideSchema).mutation(async ({ ctx, input }) => {
    if (!isAdmin(ctx.user)) throw new TRPCError({ code: "FORBIDDEN", message: "Yalnız yönetici onaylayabilir." });
    return ctx.prisma.giftVoucherClaim.update({
      where: { id: input.id },
      data: { overridden_at: new Date(), overridden_by: ctx.user.id, override_note: input.note },
    });
  }),

  delete: adminProcedure.input(giftVoucherIdSchema).mutation(({ ctx, input }) =>
    ctx.prisma.giftVoucherClaim.delete({ where: { id: input.id } })
  ),
});
