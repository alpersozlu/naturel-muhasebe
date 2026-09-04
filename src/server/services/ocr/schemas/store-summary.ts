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
   * Alışveriş Çeki Toplam — Mavi (IT POS) özetinde ayrı bir ödeme kalemi.
   * Mavi HQ (Türkiye) bu çekleri işletmeye iade eder; ayrı takip edilir.
   * Yoksa null.
   */
  shopping_voucher_total: z.number().nullable(),
  /**
   * Havale (Banka Transferi) — özette ayrı bir kalem olarak yazıyorsa dolu;
   * yoksa null/0 gönder. Sistem null/0 ise dekontları cash_sales içine
   * işlenmiş varsayar.
   */
  wire_transfer_total: z.number().nullable(),
  /**
   * Nebim (Derimod) only: net paid with the store's own "Kredi Çeki"
   * (kullanım − aynı gün düzenlenen). Almost always 0 — Jun–Aug 2026 it was
   * non-zero on 13 of 181 voucher days, max ₺3.920 — so it is NOT persisted
   * as a column; it only closes the ingest equation
   * cash + card + voucher = sales on those days. Kept in parsed_data_json.
   */
  credit_voucher_total: z.number().nullable().optional(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type StoreSummaryOcr = z.infer<typeof storeSummaryOcrSchema>;

/**
 * The shape the model is constrained to emit (structured output).
 *
 * Why a second schema: with a free-text response the model narrated
 * "ADIM 1 … ADIM 4" in prose for ~30 s (936–954 output tokens, measured on
 * a Derimod store summary) before the JSON, sometimes exhausting
 * max_tokens so no JSON arrived at all. Inside a Vercel function with a hard
 * maxDuration that is the difference between "parsed" and "stuck in
 * processing". Constraining the output to this object removes the prose.
 *
 * `check_notes` is deliberately the FIRST property: it is the model's only
 * scratchpad, so the format decision and the cash+card+loyalty+voucher =
 * sales equation check happen there, before the numbers are committed.
 *
 * Kept free of regex/default constraints (the constrained decoder rejects
 * unsupported keywords); `storeSummaryOcrSchema` re-validates strictly.
 */
export const storeSummaryOutputSchema = z.object({
  check_notes: z.string(),
  is_store_summary: z.boolean(),
  rejection_reason: z.string().nullable(),
  report_format: z.enum(["nebim", "it_pos", "unknown"]),
  store_name_on_report: z.string().nullable(),
  store_code_on_report: z.string().nullable(),
  summary_date: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  sales_total: z.number().nullable(),
  cash_sales: z.number().nullable(),
  credit_card_total: z.number().nullable(),
  loyalty_points_total: z.number().nullable(),
  shopping_voucher_total: z.number().nullable(),
  wire_transfer_total: z.number().nullable(),
  credit_voucher_total: z.number().nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
});
