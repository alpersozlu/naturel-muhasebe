import { z } from "zod";

export const zReportOcrSchema = z.object({
  report_no: z.string().min(1).nullable(),
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  gross_sales: z.number().min(0).nullable(),
  net_sales: z.number().min(0).nullable(),
  cash_sales: z.number().min(0).nullable(),
  credit_card_sales: z.number().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  vat_total: z.number().min(0).nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ZReportOcr = z.infer<typeof zReportOcrSchema>;
