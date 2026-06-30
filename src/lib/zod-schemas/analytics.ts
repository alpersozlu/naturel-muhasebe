import { z } from "zod";

export const analyticsFilterSchema = z.object({
  brand_id: z.string().uuid().optional(),
  store_id: z.string().uuid().optional(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export const expenseFilterSchema = analyticsFilterSchema.extend({
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
      "other",
    ])
    .optional(),
});

export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
export type ExpenseFilter = z.infer<typeof expenseFilterSchema>;
