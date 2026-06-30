import { z } from "zod";

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
  "other",
]);

export const expenseOcrSchema = z.object({
  is_expense: z.boolean(),
  rejection_reason: z.string().nullable(),
  vendor: z.string().min(1).nullable(),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  amount: z.number().min(0).nullable(),
  vat_rate: z.number().min(0).max(100).nullable(),
  vat_included: z.boolean().default(true),
  category: expenseCategoryEnum.default("other"),
  description: z.string().max(200).nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ExpenseOcr = z.infer<typeof expenseOcrSchema>;
