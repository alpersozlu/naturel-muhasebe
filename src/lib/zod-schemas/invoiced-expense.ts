import { z } from "zod";

export const MASRAF_KATEGORI_KEYS = [
  "ISCI",
  "YEMEK",
  "TERZI",
  "KIRTASIYE",
  "MARKET",
  "MAZOT",
  "SEYAHAT",
  "KIRA",
  "DIGER",
  "IGNORE",
] as const;

export const invoicedUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  file_base64: z.string().min(1),
});

export const invoicedBatchIdSchema = z.object({
  batch_id: z.string().uuid(),
});

export const invoicedUpdateItemSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(MASRAF_KATEGORI_KEYS),
});

export const invoicedListSchema = z.object({
  year: z.number().int().optional(),
});

export const MASRAF_BRAND_OPTIONS = ["mavi", "derimod"] as const;

/** Masraf raporu/matris/export — yıl + marka seçimi. */
export const masrafReportSchema = z.object({
  year: z.number().int().optional(),
  brand: z.enum(MASRAF_BRAND_OPTIONS).optional(),
});

export type InvoicedUploadInput = z.infer<typeof invoicedUploadSchema>;
