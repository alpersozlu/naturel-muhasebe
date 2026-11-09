import { z } from "zod";

export const bankReceiptOcrSchema = z.object({
  is_bank_receipt: z.boolean(),
  rejection_reason: z.string().nullable(),
  /** IBAN'lı banka dekontu mu, Local Pay (KKTC hesaptan ödeme uygulaması) onayı mı (17.10.2026) */
  kind: z.enum(["iban_transfer", "local_pay"]).nullable().optional().default(null),
  /** Local Pay No — IBAN'ın yerine geçen referans */
  reference_no: z.string().nullable().optional().default(null),
  payer_name: z.string().nullable().optional().default(null),
  /** Local Pay: "Ödeme Gerçekleşti" görünüyor mu */
  success: z.boolean().nullable().optional().default(null),
  bank_name: z.string().min(1).nullable(),
  iban: z.string().min(1).nullable(),
  amount: z.number().min(0).nullable(),
  /** Tutar belgede basıldığı haliyle ("3,100.00" / "3.100,00") — biçim çevirme hatasına karşı */
  amount_raw: z.string().nullable().optional().default(null),
  /** Tutar yazıyla ("Y/(TL) UÇBİNYÜZ %00") — rakam okumasının bağımsız doğrulaması */
  amount_in_words: z.string().nullable().optional().default(null),
  /** Transfer tutarına eklenen ücret satırları (FAST/EFT ücreti, BSMV/FİV) — 09.11.2026 TEB vakası */
  fee_amounts: z.array(z.number().min(0)).nullable().optional().default(null),
  /** "Hesaptan toplam … ödenmiştir" — transfer + ücretler; yazıyla tutar çoğu dekontta BU rakamdır */
  total_debited: z.number().min(0).nullable().optional().default(null),
  total_debited_raw: z.string().nullable().optional().default(null),
  deposit_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type BankReceiptOcr = z.infer<typeof bankReceiptOcrSchema>;
