import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { withAudit } from "../middleware/audit";
import { downloadFromStorage, uploadBufferToStorage } from "@/server/services/storage";
import { buildMeritCheck } from "@/server/services/merit/check";
import { normalizeName, ocrMeritCard, photoDateFromName } from "@/server/services/merit/cards";
import { getAccessibleStoreIds, isAdmin } from "@/lib/auth/permissions";

/**
 * Merit %10 Kontrolü — anlaşmalı otel personeli indirimi doğru kişiye mi yapıldı?
 * Kart fotoğrafları (MeritCard) + NEBİM fişleri (services/merit/check.ts).
 *
 * Yükleme ve OCR AYRI prosedürlerdir: 20+ fotoğrafın OCR'ı tek istekte Vercel
 * süre sınırını (60 s) aşar; istemci kartları tek tek `readCard` ile okutur.
 */
const cardAudited = withAudit("MeritCard");
const reviewAudited = withAudit("MeritInvoiceReview");

const MIME = z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filterSchema = z.object({
  store_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
});

async function applyOcr(prisma: Parameters<typeof buildMeritCheck>[0], id: string) {
  const card = await prisma.meritCard.findUniqueOrThrow({ where: { id } });
  try {
    const buf = await downloadFromStorage(card.storage_path);
    const o = await ocrMeritCard(buf, card.mime_type);
    const fullName = o.full_name?.trim() || null;
    return prisma.meritCard.update({
      where: { id },
      data: {
        ocr_status: "done",
        ocr_json: o as object,
        ocr_error: o.is_card ? null : (o.rejection_reason ?? "Kart tanınmadı"),
        is_card: o.is_card,
        hotel: o.hotel ?? card.hotel,
        full_name: fullName,
        name_key: fullName ? normalizeName(fullName) : null,
        id_no: o.id_no?.trim() || null,
        company: o.company?.trim() || null,
        department: o.department?.trim() || null,
        join_date: o.join_date?.trim() || null,
      },
    });
  } catch (e) {
    return prisma.meritCard.update({
      where: { id },
      data: { ocr_status: "failed", ocr_error: e instanceof Error ? e.message : String(e) },
    });
  }
}

export const meritRouter = router({
  /** Fişler + kartlar + durumlar. Mağaza yetkisi: admin hepsi, diğerleri erişebildiği mağazalar. */
  check: adminProcedure.input(filterSchema).query(async ({ ctx, input }) => {
    let storeIds: string[] | null = null;
    if (!isAdmin(ctx.user)) storeIds = await getAccessibleStoreIds(ctx.user);
    if (input.store_id) storeIds = storeIds ? storeIds.filter((s) => s === input.store_id) : [input.store_id];
    return buildMeritCheck(ctx.prisma, { store_ids: storeIds, date_from: input.date_from, date_to: input.date_to });
  }),

  /**
   * Kart fotoğraflarını kaydeder (storage + satır, ocr_status=pending). Aynı
   * dosya (SHA-256) ikinci kez kabul edilmez. OCR sonra `readCard` ile.
   */
  uploadCards: cardAudited
    .input(
      z.object({
        files: z
          .array(z.object({ name: z.string().max(200), mime_type: MIME, base64: z.string().min(16).max(16_000_000) }))
          .min(1)
          .max(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const created: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const f of input.files) {
        const buffer = Buffer.from(f.base64, "base64");
        if (buffer.length < 1000) {
          skipped.push({ name: f.name, reason: "boş / bozuk dosya" });
          continue;
        }
        const hash = createHash("sha256").update(buffer).digest("hex");
        const dup = await ctx.prisma.meritCard.findUnique({ where: { file_hash: hash } });
        if (dup) {
          if (dup.deleted_at) {
            await ctx.prisma.meritCard.update({ where: { id: dup.id }, data: { deleted_at: null } });
            created.push(dup.id);
          } else skipped.push({ name: f.name, reason: `zaten yüklü${dup.full_name ? ` (${dup.full_name})` : ""}` });
          continue;
        }
        const path = `merit-cards/${randomUUID()}.${EXT[f.mime_type] ?? "bin"}`;
        await uploadBufferToStorage({ path, buffer, mimeType: f.mime_type });
        const pd = photoDateFromName(f.name);
        const row = await ctx.prisma.meritCard.create({
          data: {
            storage_path: path,
            mime_type: f.mime_type,
            file_hash: hash,
            source_name: f.name,
            photo_date: pd ? new Date(`${pd}T00:00:00.000Z`) : null,
            uploaded_by: ctx.user.id,
          },
        });
        created.push(row.id);
      }
      return { created, skipped };
    }),

  /** Tek kartın OCR'ı (istemci sırayla çağırır). */
  readCard: cardAudited.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const r = await applyOcr(ctx.prisma, input.id);
    return { id: r.id, ocr_status: r.ocr_status, full_name: r.full_name, is_card: r.is_card, error: r.ocr_error };
  }),

  /** Elle düzeltme: ad / sicil / kurum / not. */
  updateCard: cardAudited
    .input(
      z.object({
        id: z.string().uuid(),
        full_name: z.string().trim().min(2).max(120).optional(),
        id_no: z.string().trim().max(40).nullable().optional(),
        company: z.string().trim().max(120).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        is_card: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      return ctx.prisma.meritCard.update({
        where: { id },
        data: { ...rest, ...(rest.full_name ? { name_key: normalizeName(rest.full_name), ocr_status: "done" } : {}) },
      });
    }),

  /** Kartı kaldır (yumuşak silme); ona bağlı elle kararlar da düşer. */
  deleteCard: cardAudited.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.prisma.meritInvoiceReview.deleteMany({ where: { card_id: input.id } });
    return ctx.prisma.meritCard.update({ where: { id: input.id }, data: { deleted_at: new Date() } });
  }),

  /** Fişi bir karta elle bağla. */
  link: reviewAudited
    .input(z.object({ invoice_ref: z.string().min(3).max(40), card_id: z.string().uuid(), note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.prisma.meritCard.findFirst({ where: { id: input.card_id, deleted_at: null } });
      if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Kart bulunamadı" });
      return ctx.prisma.meritInvoiceReview.upsert({
        where: { invoice_ref: input.invoice_ref },
        create: { invoice_ref: input.invoice_ref, card_id: card.id, decision: "card", note: input.note ?? null, decided_by: ctx.user.id },
        update: { card_id: card.id, decision: "card", note: input.note ?? null, decided_by: ctx.user.id, decided_at: new Date() },
      });
    }),

  /** Kartsız kabul (ör. kart sonradan görüldü) ya da red (indirim hak edilmemiş). */
  decide: reviewAudited
    .input(z.object({ invoice_ref: z.string().min(3).max(40), decision: z.enum(["no_card_ok", "rejected"]), note: z.string().trim().min(3, "Not zorunlu").max(500) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.meritInvoiceReview.upsert({
        where: { invoice_ref: input.invoice_ref },
        create: { invoice_ref: input.invoice_ref, card_id: null, decision: input.decision, note: input.note, decided_by: ctx.user.id },
        update: { card_id: null, decision: input.decision, note: input.note, decided_by: ctx.user.id, decided_at: new Date() },
      })
    ),

  /** Kararı geri al — fiş yeniden otomatik eşleşmeye döner. */
  clear: reviewAudited.input(z.object({ invoice_ref: z.string().min(3).max(40) })).mutation(async ({ ctx, input }) => {
    await ctx.prisma.meritInvoiceReview.deleteMany({ where: { invoice_ref: input.invoice_ref } });
    return { ok: true };
  }),
});
