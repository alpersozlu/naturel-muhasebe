import { z } from "zod";

export const posSlipOcrSchema = z.object({
  is_pos_slip: z.boolean(),
  rejection_reason: z.string().nullable(),
  bank_name: z.string().min(1).nullable(),
  terminal_no: z.string().min(1).nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  sales_count: z.number().int().min(0).nullable(),
  sales_amount: z.number().min(0).nullable(),
  refund_count: z.number().int().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  net_amount: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type PosSlipOcr = z.infer<typeof posSlipOcrSchema>;
