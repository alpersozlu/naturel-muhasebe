import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import {
  giftVoucherClaimInputSchema,
  giftVoucherIdSchema,
  giftVoucherListSchema,
  giftVoucherOverrideSchema,
} from "@/lib/zod-schemas/gift-voucher";
import { previewClaim, recheckPending } from "@/server/services/gift-voucher/check";
import { isAdmin } from "@/lib/auth/permissions";

const claimAudited = withAudit("GiftVoucherClaim");
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
  preview: protectedProcedure.input(giftVoucherClaimInputSchema).query(({ ctx, input }) =>
    previewClaim(ctx.prisma, { ...input, used_date: input.used_date ?? todayIso() })
  ),

  /** Kararı kaydet. Aynı çek barkodu ikinci kez kaydedilemez. */
  claim: claimAudited.input(giftVoucherClaimInputSchema).mutation(async ({ ctx, input }) => {
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
    return ctx.prisma.giftVoucherClaim.create({
      data: {
        barcode: p.voucher.barcode,
        is_manual: p.voucher.manual,
        amount: p.voucher.amount,
        receipt_ref: input.receipt_ref.trim(),
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
  }),

  list: protectedProcedure.input(giftVoucherListSchema).query(async ({ ctx, input }) => {
    const rows = await ctx.prisma.giftVoucherClaim.findMany({
      where: {
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

  counts: protectedProcedure.query(async ({ ctx }) => {
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
