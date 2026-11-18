import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const giftVoucherClaimInputSchema = z
  .object({
  /** Çekin okutulan EAN-13 barkodu. Barkodsuz eski çekte boş bırakılır. */
  voucher_barcode: z.string().trim().max(40).optional().nullable(),
  /** Barkodsuz ESKİ çek: küpür elle girilir (sahibi, 16.11.2026). */
  manual_amount: z.coerce.number().positive().max(100000).optional().nullable(),
  /** Mavi fişinin barkodu / fatura numarası. */
  receipt_ref: z.string().trim().min(6).max(40),
  /** Çekin Derimod'da kullanıldığı gün — boşsa bugün. */
  used_date: dateOnly.optional().nullable(),
  used_store_id: z.string().uuid().optional().nullable(),
  customer_name: z.string().trim().max(120).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const hasBarcode = !!v.voucher_barcode && v.voucher_barcode.trim().length >= 8;
    if (!hasBarcode && !v.manual_amount) {
      ctx.addIssue({
        code: "custom",
        path: ["voucher_barcode"],
        message: "Çekin barkodunu okutun ya da barkodsuz eski çekse tutarını girin",
      });
    }
  });

export const giftVoucherListSchema = z.object({
  /** Kullanıldığı mağaza — yönetici olmayan için ZORUNLU (kendi mağazası). */
  store_id: z.string().uuid().optional(),
  status: z.enum(["all", "ok", "pending", "fail"]).default("all"),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const giftVoucherOverrideSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(5, "Gerekçe yazın").max(500),
});

export const giftVoucherIdSchema = z.object({ id: z.string().uuid() });
