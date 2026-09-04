import { z } from "zod";

/**
 * Z raporundan SADECE toplam/meta alanları okuyoruz.
 * cash_sales ve credit_card_sales artık çıkarılmıyor — onlar başka
 * veri kaynaklarından geliyor (POS fişi OCR, mağaza özeti).
 */
export const zReportOcrSchema = z.object({
  is_z_report: z.boolean(),
  rejection_reason: z.string().nullable(),
  report_no: z.string().min(1).nullable(),
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Belgedeki tarih HARFİYEN ("25-08-2026") — sunucu GG-AA-YY ile çözer.
   *  Eklenme sebebi: Girne 25.08.2026 Z raporu modelce 2025-08-25 diye
   *  yorumlandı; ham metin olmadan gün/yıl takası da kurtaramadı (25=25). */
  report_date_raw: z.string().max(40).nullable().optional(),
  gross_sales: z.number().min(0).nullable(),
  net_sales: z.number().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  vat_total: z.number().min(0).nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ZReportOcr = z.infer<typeof zReportOcrSchema>;

/** Structured-output shape: `check_notes` first, no regex/min constraints. */
export const zReportOutputSchema = z.object({
  check_notes: z.string(),
  is_z_report: z.boolean(),
  rejection_reason: z.string().nullable(),
  report_no: z.string().nullable(),
  report_date: z.string().nullable(),
  report_date_raw: z.string().nullable(),
  gross_sales: z.number().nullable(),
  net_sales: z.number().nullable(),
  refund_amount: z.number().nullable(),
  vat_total: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
});
