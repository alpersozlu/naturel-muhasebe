import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const manualInvoiceCreateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
  amount: z.number().positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  invoice_no: z.string().max(50).optional().or(z.literal("")),
  invoice_date: dateOnly.optional().or(z.literal("")),
  description: z.string().max(200).optional().or(z.literal("")),
});

export const manualInvoiceIdSchema = z.object({ id: z.string().uuid() });

export const manualInvoicesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type ManualInvoiceCreateInput = z.infer<typeof manualInvoiceCreateSchema>;
