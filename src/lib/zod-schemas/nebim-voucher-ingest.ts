import { z } from "zod";

/**
 * NEBIM köprüsünden gelen kredi çeki verisi (/api/ingest/vouchers).
 * txns: ödeme hareketleri (eksi = çek düzenlendi, artı = çek kullanıldı).
 * cards: cdGiftCard anlık görüntüsü (kalan bakiye = amount - used_amount).
 */
export const nebimVoucherTxnSchema = z.object({
  payment_line_id: z.string().min(1), // Nebim PaymentLineID (idempotent anahtar)
  payment_no: z.string().nullish(),
  txn_date: z.coerce.date(),
  txn_time: z.string().nullish(),
  store_code: z.string().nullish(),
  store_name: z.string().nullish(),
  amount: z.number(),
  customer_code: z.string().nullish(),
  customer_name: z.string().nullish(),
  serial: z.string().nullish(),
  invoice_ref: z.string().nullish(),
});

export const nebimVoucherCardSchema = z.object({
  serial: z.string().min(1),
  amount: z.number(),
  used_amount: z.number(),
  first_valid: z.coerce.date().nullish(),
  last_valid: z.coerce.date().nullish(),
  is_used: z.boolean().default(false),
  is_blocked: z.boolean().default(false),
  nebim_created: z.coerce.date().nullish(),
});

export const nebimVoucherIngestSchema = z.object({
  company_code: z.number().int().default(1),
  txns: z.array(nebimVoucherTxnSchema).max(20000).default([]),
  cards: z.array(nebimVoucherCardSchema).max(20000).default([]),
});

export type NebimVoucherIngestInput = z.infer<typeof nebimVoucherIngestSchema>;
