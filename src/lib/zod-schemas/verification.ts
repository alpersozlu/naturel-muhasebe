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

export const setReportedCashSchema = z.object({
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
});

export const setGiftVoucherSchema = z.object({
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
});

// Mavi Hediye Çeki (Derimod'da kullanılan) — kasa ile alakasız, istatistik
export const setMaviGiftVoucherSchema = z.object({
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
});

// Kümülatif kasa birleşmesi (Mavi) — bu günün özetinden çıkarılacak önceki gün
export const setCumulativePrevSchema = z.object({
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prev_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
