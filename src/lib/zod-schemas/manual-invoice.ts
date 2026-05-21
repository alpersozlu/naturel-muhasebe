import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

// Boş string ya da undefined → undefined olarak normalize et.
// Sonra opsiyonel string olarak parse — ".or(z.literal(\"\"))" pattern'inin
// ürettiği "Invalid input" jenerik hatasını önler.
const nullEmpty = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

export const manualInvoiceCreateSchema = z.object({
  store_id: z.string().uuid("Mağaza seçilmedi"),
  date: dateOnly,
  amount: z
    .number({ message: "Tutar bir sayı olmalı" })
    .positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  invoice_no: z.preprocess(
    nullEmpty,
    z.string().max(50, "Fatura no 50 karakterden uzun olamaz").optional()
  ),
  invoice_date: z.preprocess(nullEmpty, dateOnly.optional()),
  description: z.preprocess(
    nullEmpty,
    z.string().max(200, "Açıklama 200 karakterden uzun olamaz").optional()
  ),
});

export const manualInvoiceIdSchema = z.object({ id: z.string().uuid() });

export const manualInvoicesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type ManualInvoiceCreateInput = z.infer<typeof manualInvoiceCreateSchema>;
