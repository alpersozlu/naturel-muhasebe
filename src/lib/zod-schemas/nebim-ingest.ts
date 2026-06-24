import { z } from "zod";

/**
 * NEBIM köprüsünden gelen tek bir perakende satış satırı.
 * Köprü Windows tarafında çalışır ve /api/ingest/retail-sales'e POST eder.
 * Tutarlar yerel para (TRY) cinsindendir; iadeler eksi (-) değerlerle gelir.
 */
export const nebimSaleLineSchema = z.object({
  invoice_ref: z.string().min(1), // Fatura ref no, örn "1-R-7-87640"
  sort_order: z.number().int(), // Fiş içi satır sırası

  store_code: z.string().nullish(), // Ham NEBIM mağaza kodu (S01/S02/S03)
  store_name: z.string().nullish(), // NEBIM mağaza adı ("Girne Mağaza")

  invoice_date: z.coerce.date(),
  created_date: z.coerce.date().nullish(),

  is_return: z.boolean().default(false),
  office: z.string().nullish(),

  item_code: z.string().nullish(),
  item_desc: z.string().nullish(),
  color_code: z.string().nullish(),
  color_desc: z.string().nullish(),
  size: z.string().nullish(),

  salesperson_code: z.string().nullish(),
  salesperson_name: z.string().nullish(),

  customer_code: z.string().nullish(), // CurrAccCode
  customer_name: z.string().nullish(), // cdCurrAcc.FullName (isimli müşteri)

  payment_type: z.string().nullish(), // "Nakit" / "Kredi Kartı" / "Nakit + Kredi Kartı"
  card_type: z.string().nullish(), // kart markası (Maksimum, Garanti Bonus…)

  qty: z.number(),
  price: z.number().nullish(),
  vat_rate: z.number().nullish(),
  amount_vi: z.number().nullish(), // Tutar (VD)(D)
  line_disc: z.number().nullish(), // Toplam satır iskonto
  doc_disc: z.number().nullish(), // Toplam dip iskonto
  tax_base: z.number().nullish(), // Vergi hariç tutar (KDV matrahı)
  vat: z.number().nullish(), // KDV
  net_amount: z.number().nullish(), // Net tutar (KDV dahil)

  invoice_note: z.string().nullish(), // trInvoiceHeader.Description — elle girilen not
  discount_reason: z.string().nullish(), // cdDiscountReasonDesc — iskonto nedeni
  campaign: z.string().nullish(), // tpInvoiceDiscountOffer → kampanya adı/adları
});

export const nebimIngestSchema = z.object({
  company_code: z.number().int().default(1),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
  lines: z.array(nebimSaleLineSchema).min(1).max(20000),
});

export type NebimSaleLineInput = z.infer<typeof nebimSaleLineSchema>;
export type NebimIngestInput = z.infer<typeof nebimIngestSchema>;
