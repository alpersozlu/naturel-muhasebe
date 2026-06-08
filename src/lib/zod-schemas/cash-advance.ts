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

export const STAFF_ROLES = ["manager", "assistant_manager", "sales_staff"] as const;

export const cashAdvanceCreateSchema = z
  .object({
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
    // AVANS (category=bonus) için rol + isim
    staff_role: z
      .union([z.enum(STAFF_ROLES), z.null(), z.undefined()])
      .transform((v) => v ?? undefined),
    staff_name: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v && typeof v === "string" && v.trim() ? v.trim() : undefined)),
  })
  .superRefine((val, ctx) => {
    // Avans ise rol + isim zorunlu
    if (val.category === "bonus") {
      if (!val.staff_role) {
        ctx.addIssue({
          code: "custom",
          path: ["staff_role"],
          message: "Avans için personel rolü seçilmeli (Müdür / Müdür Yrd. / Satış)",
        });
      }
      if (!val.staff_name) {
        ctx.addIssue({
          code: "custom",
          path: ["staff_name"],
          message: "Avans için isim soyisim girilmeli",
        });
      }
    }
  });

export const cashAdvanceIdSchema = z.object({ id: z.string().uuid() });

export const cashAdvancesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type CashAdvanceCreateInput = z.infer<typeof cashAdvanceCreateSchema>;
