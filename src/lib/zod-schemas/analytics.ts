import { z } from "zod";

export const analyticsFilterSchema = z.object({
  brand_id: z.string().uuid().optional(),
  store_id: z.string().uuid().optional(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const expenseFilterSchema = analyticsFilterSchema.extend({
  /**
   * Optional day range. When both are given the period (KPIs, categories,
   * stores, daily view) is [date_from, date_to] inclusive instead of the
   * calendar month; year/month still drive the yearly trend and matrix.
   */
  date_from: isoDay.optional(),
  date_to: isoDay.optional(),
  employee_id: z.string().uuid().optional(),
  category: z
    .enum([
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
      "tailor",
      "other",
    ])
    .optional(),
});

export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
export type ExpenseFilter = z.infer<typeof expenseFilterSchema>;
