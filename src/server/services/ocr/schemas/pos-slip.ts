import { z } from "zod";

/** Tek slipteki bir bankanın gün sonu bloğu (ortak terminal slipleri). */
export const posSlipSectionSchema = z.object({
  bank_name: z.string().min(1),
  terminal_no: z.string().min(1).nullable(),
  sales_count: z.number().int().min(0).nullable(),
  sales_amount: z.number().min(0).nullable(),
  refund_count: z.number().int().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  net_amount: z.number().nullable(),
});
export type PosSlipSection = z.infer<typeof posSlipSectionSchema>;

export const posSlipOcrSchema = z.object({
  is_pos_slip: z.boolean(),
  rejection_reason: z.string().nullable(),
  bank_name: z.string().min(1).nullable(),
  terminal_no: z.string().min(1).nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Slipteki tarih harfiyen ("24/08/26") — sunucu GG-AA-YY ile çözer. */
  date_raw: z.string().max(40).nullable().optional(),
  sales_count: z.number().int().min(0).nullable(),
  sales_amount: z.number().min(0).nullable(),
  refund_count: z.number().int().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  net_amount: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
  /**
   * Slip birden fazla bankanın gün sonunu taşıyorsa (Koopbank Optimum +
   * Yapı Kredi ortak terminali) her banka burada AYRI bir eleman olur.
   * Tek bankalı slipte boş/eksik bırakılır; üstteki tekil alanlar geçerlidir.
   */
  sections: z.array(posSlipSectionSchema).optional(),
});

export type PosSlipOcr = z.infer<typeof posSlipOcrSchema>;
