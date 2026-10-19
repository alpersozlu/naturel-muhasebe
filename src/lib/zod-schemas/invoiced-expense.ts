import { z } from "zod";

export const MASRAF_KATEGORI_KEYS = [
  "ISCI",
  "YEMEK",
  "TEMIZLIK",
  "TERZI",
  "KIRTASIYE",
  "MARKET",
  "MAZOT",
  "SEYAHAT",
  "KIRA",
  "ELEKTRIK",
  "TELEFON_INTERNET",
  "KARGO",
  "BANKA",
  "MUHASEBE",
  "SIGORTA",
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

const month = z.number().int().min(1).max(12);
const year = z.number().int().min(2024).max(2100);
const MIME = z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

/** Fatura fotoğrafı yükleme (sahibi, aylık). */
export const masrafPhotoUploadSchema = z.object({
  year,
  month,
  files: z
    .array(z.object({ name: z.string().max(200), mime_type: MIME, base64: z.string().min(16).max(16_000_000) }))
    .min(1)
    .max(40),
});
export const masrafPhotoIdSchema = z.object({ id: z.string().uuid() });
export const masrafPhotoListSchema = z.object({ year, month });
export const masrafPhotoUpdateSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(MASRAF_KATEGORI_KEYS).optional(),
  classification: z.enum(["company", "excluded", "pending"]).optional(),
  period_month: month.optional(),
  period_year: year.optional(),
  amount_try: z.number().min(0).max(100_000_000).optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  belongs_month: month.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export const masrafPhotoLinkSchema = z.object({ id: z.string().uuid(), expense_id: z.string().uuid() });

/** Kasa kalemleri (mağaza masrafı / faturasız peşin ödeme) — ay listesi + kategori düzeltme. */
export const masrafCashItemsSchema = z.object({ year, month, brand: z.enum(MASRAF_BRAND_OPTIONS).optional() });
export const masrafCashCategorySchema = z.object({
  source: z.enum(["expense", "cash_advance"]),
  id: z.string().uuid(),
  category: z.enum(MASRAF_KATEGORI_KEYS).nullable(),
});

/** Elle girilen hücre (SSK, yol, elektrik…): tutar 0 → kayıt silinir. */
export const masrafManualSetSchema = z.object({
  brand: z.enum(MASRAF_BRAND_OPTIONS),
  year,
  month,
  store_code: z.string().min(2).max(8),
  row_key: z.string().min(2).max(40),
  amount_try: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).nullable().optional(),
});

export type InvoicedUploadInput = z.infer<typeof invoicedUploadSchema>;
