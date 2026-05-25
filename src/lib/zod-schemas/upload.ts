import { z } from "zod";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { EXPENSE_CATEGORIES } from "@/lib/zod-schemas/budget";

export const uploadTypeEnum = z.enum([
  "bank_receipt",
  "pos_slip",
  "store_summary",
  "expense",
  "cash_advance",
  "z_report",
  "dealer_daily_report",
]);

/**
 * Kullanıcının yükleme anında girdiği opsiyonel meta veriler.
 * OCR çalıştıktan sonra bu değerler (varsa) sonucu override eder.
 * Şu an: sadece expense kategori + açıklama.
 */
export const userMetaSchema = z
  .object({
    expense_category: z
      .union([z.enum(EXPENSE_CATEGORIES), z.null(), z.undefined()])
      .transform((v) => v ?? undefined)
      .optional(),
    expense_description: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) =>
        v && typeof v === "string" && v.trim() ? v.trim() : undefined
      )
      .optional(),
  })
  .optional();

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const uploadCreateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
  type: uploadTypeEnum,
  filename: z.string().min(1).max(200),
  mime_type: z.enum(ACCEPTED_MIME_TYPES),
  // base64-encoded file (no data: prefix)
  file_base64: z
    .string()
    .min(1)
    .refine(
      (s) => Math.ceil((s.length * 3) / 4) <= MAX_UPLOAD_BYTES,
      `Dosya ${MAX_UPLOAD_BYTES / 1024 / 1024} MB'dan büyük olamaz`
    ),
  // Opsiyonel — kullanıcının yükleme öncesi girdiği meta (ör. expense kategori/açıklama)
  user_meta: userMetaSchema,
});

export const uploadIdSchema = z.object({
  id: z.string().uuid(),
});

export const uploadsForRecordSchema = z.object({
  daily_record_id: z.string().uuid(),
});

export const uploadsForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;
