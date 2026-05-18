import { z } from "zod";

export const storeSummaryOcrSchema = z.object({
  sales_total: z.number().nullable(),
  cash_sales: z.number().nullable(),
  credit_card_total: z.number().nullable(),
  loyalty_points_total: z.number().nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type StoreSummaryOcr = z.infer<typeof storeSummaryOcrSchema>;
