import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const CORPORATE_PURCHASE_TYPES = ["corporate", "management"] as const;

export const corporatePurchaseCreateSchema = z
  .object({
    store_id: z.string().uuid(),
    date: dateOnly,
    type: z.enum(CORPORATE_PURCHASE_TYPES),
    // Kurumsal için şirket adı — opsiyonel (boş bırakılabilir)
    company_name: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v && typeof v === "string" && v.trim() ? v.trim() : undefined)),
    // İsim soyisim — HER ZAMAN zorunlu
    person_name: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v && typeof v === "string" && v.trim() ? v.trim() : undefined)),
    amount: z.number().positive("Tutar 0'dan büyük olmalı"),
    currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
    is_paid: z.boolean().default(false),
    note: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v && typeof v === "string" && v.trim() ? v.trim() : undefined)),
  })
  .superRefine((val, ctx) => {
    // İsim soyisim her zaman zorunlu
    if (!val.person_name) {
      ctx.addIssue({
        code: "custom",
        path: ["person_name"],
        message: "İsim soyisim girilmeli (kim aldı)",
      });
    }
  });

export const corporatePurchaseIdSchema = z.object({ id: z.string().uuid() });

export const corporatePurchaseSetPaidSchema = z.object({
  id: z.string().uuid(),
  is_paid: z.boolean(),
});

export const corporatePurchasesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type CorporatePurchaseCreateInput = z.infer<
  typeof corporatePurchaseCreateSchema
>;
