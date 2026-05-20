import { z } from "zod";

export const storeSummaryOcrSchema = z.object({
  is_store_summary: z.boolean(),
  rejection_reason: z.string().nullable(),
  /** "nebim" → Derimod kullanıyor; "it_pos" → Mavi kullanıyor; "unknown" → ne biri ne öteki */
  report_format: z.enum(["nebim", "it_pos", "unknown"]),
  /** Raporun başında yazan mağaza adı (örn "KBR NATUREL GÜZELYURT" ya da "Mavi Girne") */
  store_name_on_report: z.string().nullable(),
  summary_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  sales_total: z.number().nullable(),
  cash_sales: z.number().nullable(),
  credit_card_total: z.number().nullable(),
  loyalty_points_total: z.number().nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type StoreSummaryOcr = z.infer<typeof storeSummaryOcrSchema>;
