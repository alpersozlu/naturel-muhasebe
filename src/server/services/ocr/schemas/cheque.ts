import { z } from "zod";

/**
 * BANKA ÇEKİ (müşterinin verdiği çek). Kritik alan `amount`: kasada nakit sayıldığı için
 * yanlış okuma günün nakit denklemini bozar. Çekte tutar hem rakamla (kutu
 * içinde) hem YAZIYLA yazılır — ikisi birbirini doğrular (amount-words.ts).
 */
export const chequeOcrSchema = z.object({
  is_cheque: z.boolean(),
  rejection_reason: z.string().nullable(),
  bank_name: z.string().min(1).nullable(),
  branch: z.string().nullable().optional().default(null),
  cheque_no: z.string().nullable().optional().default(null),
  /** "Pay / Yalnız" satırı — çekin lehtarı ("Naturel Ticaret") */
  payee_name: z.string().nullable().optional().default(null),
  /** Çeki veren: imza bloğundaki ad ya da hesap sahibi ("KANER SARUHAN") */
  drawer_name: z.string().nullable().optional().default(null),
  account_no: z.string().nullable().optional().default(null),
  amount: z.number().min(0).nullable(),
  /** Kutudaki tutar basıldığı/yazıldığı haliyle ("TL-2000 TL", "2.000,00") */
  amount_raw: z.string().nullable().optional().default(null),
  /** Tutar yazıyla ("İki Bin TL") — rakamın bağımsız doğrulaması */
  amount_in_words: z.string().nullable().optional().default(null),
  /** Çekin üstündeki tarih — ileri tarihli olabilir */
  cheque_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ChequeOcr = z.infer<typeof chequeOcrSchema>;
