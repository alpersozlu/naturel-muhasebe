import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

/** Optional string — boş/null/undefined hepsi geçerli. */
const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v && typeof v === "string" && v.trim() ? v.trim() : undefined));

/** Optional ISO date — boş geçerli, doluysa YYYY-MM-DD olmak zorunda. */
const optionalIsoDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === "" || v == null ? undefined : v))
  .pipe(dateOnly.optional());

/** Sadece form'da kullanıcının girdiği alanlar — store_id/date prop'lardan gelir. */
export const manualInvoiceFormSchema = z.object({
  amount: z.coerce
    .number({ message: "Tutar bir sayı olmalı" })
    .positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  invoice_no: optionalString,
  invoice_date: optionalIsoDate,
  description: optionalString,
});

/** API'ye gönderilen tam payload — store_id/date dahil. */
export const manualInvoiceCreateSchema = manualInvoiceFormSchema.extend({
  store_id: z.string().uuid("Mağaza seçilmedi"),
  date: dateOnly,
});

export const manualInvoiceIdSchema = z.object({ id: z.string().uuid() });

export const manualInvoicesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type ManualInvoiceFormInput = z.input<typeof manualInvoiceFormSchema>;
export type ManualInvoiceCreateInput = z.input<typeof manualInvoiceCreateSchema>;
export type ManualInvoiceCreateOutput = z.output<typeof manualInvoiceCreateSchema>;
