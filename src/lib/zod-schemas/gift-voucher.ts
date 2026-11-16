import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const giftVoucherClaimInputSchema = z.object({
  /** Çekin okutulan EAN-13 barkodu. */
  voucher_barcode: z.string().trim().min(8).max(40),
  /** Mavi fişinin barkodu / fatura numarası. */
  receipt_ref: z.string().trim().min(6).max(40),
  /** Çekin Derimod'da kullanıldığı gün — boşsa bugün. */
  used_date: dateOnly.optional().nullable(),
  used_store_id: z.string().uuid().optional().nullable(),
  customer_name: z.string().trim().max(120).optional().nullable(),
});

export const giftVoucherListSchema = z.object({
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
