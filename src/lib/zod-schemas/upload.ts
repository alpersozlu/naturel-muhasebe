import { z } from "zod";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

export const uploadTypeEnum = z.enum([
  "bank_receipt",
  "pos_slip",
  "store_summary",
  "expense",
  "cash_advance",
]);

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
