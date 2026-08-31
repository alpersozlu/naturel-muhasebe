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
  "food",
  "marketing",
  "labor",
  "other",
]);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const STAFF_ROLES = ["manager", "assistant_manager", "sales_staff"] as const;

/**
 * ⚠️ Zod 4 TUZAĞI: `z.union([X, z.null(), z.undefined()])` bir alanı optional
 * YAPMAZ. `isOptional()` yanıltıcı biçimde true döner ama key JSON'da yoksa
 * (superjson transform sonrası `undefined` alanlar düşebilir) parse
 * "Invalid input: expected nonoptional, received undefined" ile patlar —
 * kullanıcı toast'ta yalnızca "Invalid input" görür. Doğrusu `.nullish()`.
 *
 * FORM alanları — `store_id`/`date` BİLEREK yok; karta prop olarak gelir ve
 * submit anında eklenir (RHF `defaultValues` reactive değildir, mağaza
 * sonradan seçilince form içindeki değer bayat kalırdı).
 */
const cashAdvanceBase = z.object({
  // Çalışan opsiyonel — "" / null = çalışan seçilmedi
  employee_id: z
    .union([z.string().uuid(), z.literal("")])
    .nullish()
    .transform((v) => (v ? v : undefined)),
  amount: z.coerce.number().positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  category: expenseCategoryEnum,
  description: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => (v && v.length ? v : undefined)),
  // AVANS (category=bonus) için rol + isim
  staff_role: z
    .enum(STAFF_ROLES)
    .nullish()
    .transform((v) => v ?? undefined),
  staff_name: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
});

/** Avans ise rol + isim zorunlu — form ve sunucu tarafında aynı kural. */
const requireStaffForAdvance = (
  val: { category: string; staff_role?: string; staff_name?: string },
  ctx: z.RefinementCtx
) => {
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
};

export const cashAdvanceFormSchema =
  cashAdvanceBase.superRefine(requireStaffForAdvance);

/** Sunucuya giden tam girdi = form alanları + mağaza/gün. */
export const cashAdvanceCreateSchema = cashAdvanceBase
  .extend({ store_id: z.string().uuid(), date: dateOnly })
  .superRefine(requireStaffForAdvance);

export const cashAdvanceIdSchema = z.object({ id: z.string().uuid() });

export const cashAdvancesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type CashAdvanceCreateInput = z.infer<typeof cashAdvanceCreateSchema>;
/** Formun tuttuğu ham değerler (transform/default öncesi). */
export type CashAdvanceFormInput = z.input<typeof cashAdvanceFormSchema>;
