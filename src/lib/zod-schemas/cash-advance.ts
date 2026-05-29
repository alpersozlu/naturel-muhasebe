import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const expenseCategoryEnum = z.enum([
  "rent",
  "electricity",
  "water",
  "internet",
  "stationery",
  "cleaning",
  "maintenance",
  "salary",
  "bonus",
  "supplies",
  "marketing",
  "other",
]);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const cashAdvanceCreateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
  // Çalışan opsiyonel — "" / null = çalışan seçilmedi
  employee_id: z
    .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v && typeof v === "string" ? v : undefined)),
  amount: z.number().positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  category: expenseCategoryEnum,
  description: z.string().max(200).optional().or(z.literal("")),
});

export const cashAdvanceIdSchema = z.object({ id: z.string().uuid() });

export const cashAdvancesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type CashAdvanceCreateInput = z.infer<typeof cashAdvanceCreateSchema>;
