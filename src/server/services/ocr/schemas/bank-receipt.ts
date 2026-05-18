import { z } from "zod";

export const bankReceiptOcrSchema = z.object({
  bank_name: z.string().min(1).nullable(),
  iban: z.string().min(1).nullable(),
  amount: z.number().min(0).nullable(),
  deposit_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type BankReceiptOcr = z.infer<typeof bankReceiptOcrSchema>;
