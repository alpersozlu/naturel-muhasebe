import { z } from "zod";

/**
 * Z raporundan SADECE toplam/meta alanları okuyoruz.
 * cash_sales ve credit_card_sales artık çıkarılmıyor — onlar başka
 * veri kaynaklarından geliyor (POS fişi OCR, mağaza özeti).
 */
export const zReportOcrSchema = z.object({
  report_no: z.string().min(1).nullable(),
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  gross_sales: z.number().min(0).nullable(),
  net_sales: z.number().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  vat_total: z.number().min(0).nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ZReportOcr = z.infer<typeof zReportOcrSchema>;
