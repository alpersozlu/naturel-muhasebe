import { z } from "zod";

/**
 * Kurumsal / yönetim alışverişinin bilgi fişi (Mavi mağaza yazarkasa çıktısı).
 * Tek kritik alan `payable_total`: forma girilen tutarla bu eşleşmelidir.
 */
export const corporateReceiptOcrSchema = z.object({
  is_receipt: z.boolean(),
  rejection_reason: z.string().nullable(),
  /** "Ödenecek Tutar" — karşılaştırmanın yapıldığı rakam */
  payable_total: z.number().nullable(),
  /** "Toplam Hizmet Tutarı" (indirim öncesi) — bilgi amaçlı */
  gross_total: z.number().nullable(),
  discount_total: z.number().nullable(),
  /** "Fatura Tarihi" → YYYY-MM-DD */
  receipt_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** "Fatura No" — aynı fişin iki kez kullanılmasını tespit etmeye yarar */
  invoice_no: z.string().nullable(),
  /** "Müşteri Ad Soyad" — forma girilen isimle karşılaştırılabilir */
  customer_name: z.string().nullable(),
  /** Fişin üstündeki mağaza satırı, örn "9402 - KIB NATURAL MAGOSA CD" */
  store_line: z.string().nullable(),
  payment_type: z.string().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type CorporateReceiptOcr = z.infer<typeof corporateReceiptOcrSchema>;
