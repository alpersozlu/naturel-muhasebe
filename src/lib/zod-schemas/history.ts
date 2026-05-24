import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const historyFilterSchema = z.object({
  brand_id: z.string().uuid().optional(),
  store_id: z.string().uuid().optional(),
  type: z
    .enum([
      "bank_receipt",
      "pos_slip",
      "store_summary",
      "expense",
      "cash_advance",
      "z_report",
      "dealer_daily_report",
    ])
    .optional(),
  status: z
    .enum(["pending", "processing", "parsed", "confirmed", "failed"])
    .optional(),
  uploaded_by: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type HistoryFilter = z.infer<typeof historyFilterSchema>;
