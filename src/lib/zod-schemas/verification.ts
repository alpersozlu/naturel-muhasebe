import { z } from "zod";

export const verifyMonthSchema = z.object({
  store_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export const verifyDaySchema = z.object({
  daily_record_id: z.string().uuid(),
});

export const dailyRecordIdSchema = z.object({
  id: z.string().uuid(),
});
