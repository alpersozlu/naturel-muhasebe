import { z } from "zod";

export const storeSummaryOcrSchema = z.object({
  is_store_summary: z.boolean(),
  rejection_reason: z.string().nullable(),
  /** "nebim" → Derimod kullanıyor; "it_pos" → Mavi kullanıyor; "unknown" → ne biri ne öteki */
  report_format: z.enum(["nebim", "it_pos", "unknown"]),
  /** Raporun başında yazan mağaza adı (örn "KBR NATUREL GÜZELYURT" ya da "Mavi Girne") */
  store_name_on_report: z.string().nullable(),
  /**
   * Mavi (IT POS) için zorunlu — başlıktaki numerik mağaza kodu (örn "9402", "9403").
   * Nebim raporlarında bulunmaz; null gönder.
   */
  store_code_on_report: z.string().nullable(),
  summary_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /**
   * Derimod özetinin alt kısmında tarih ARALIĞI yazıyorsa (gün birleşmesi).
   * Tek gün ise period_start = period_end = summary_date. Aralık varsa
   * (örn 19-20 Mayıs) ilk ve son gün. Yoksa null.
   */
  period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  sales_total: z.number().nullable(),
  cash_sales: z.number().nullable(),
  credit_card_total: z.number().nullable(),
  loyalty_points_total: z.number().nullable(),
  /**
   * Havale (Banka Transferi) — özette ayrı bir kalem olarak yazıyorsa dolu;
   * yoksa null/0 gönder. Sistem null/0 ise dekontları cash_sales içine
   * işlenmiş varsayar.
   */
  wire_transfer_total: z.number().nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type StoreSummaryOcr = z.infer<typeof storeSummaryOcrSchema>;
