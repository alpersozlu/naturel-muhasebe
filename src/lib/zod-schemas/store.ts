import { z } from "zod";

export const storeCreateSchema = z.object({
  brand_id: z.string().uuid(),
  name: z.string().trim().min(2, "En az 2 karakter").max(80, "En fazla 80 karakter"),
  city: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  address: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export const storeUpdateSchema = storeCreateSchema.extend({
  id: z.string().uuid(),
});

export const storeIdSchema = z.object({
  id: z.string().uuid(),
});

export const storesByBrandSchema = z.object({
  brand_id: z.string().uuid(),
});

export const storeMonthlyCalendarSchema = z.object({
  store_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export type StoreCreateInput = z.infer<typeof storeCreateSchema>;
export type StoreUpdateInput = z.infer<typeof storeUpdateSchema>;
