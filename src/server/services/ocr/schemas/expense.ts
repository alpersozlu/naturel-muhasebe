import { z } from "zod";

const expenseCategoryEnum = z.enum([
  "rent",
  "electricity",
  "water",
  "internet",
  "stationery",
  "cleaning",
  "maintenance",
  "salary",
  "bonus",
  "supplies",
  "food",
  "marketing",
  "labor",
  "tailor",
  "glazier",
  "other",
]);

export const expenseOcrSchema = z.object({
  is_expense: z.boolean(),
  rejection_reason: z.string().nullable(),
  vendor: z.string().min(1).nullable(),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Belgedeki tarih HARFİYEN ("24,8,26", "24/08/2026") — sunucu bunu
   *  GG-AA-YY sırasıyla kendisi çözer; modelin ISO yorumuna güvenmez. */
  expense_date_raw: z.string().max(40).nullable().optional(),
  /** Fatura / fiş seri-sıra numarası (başlıktaki basılı numara, "1419"). Aynı
   *  satıcıdan aynı gün aynı tutarlı iki ayrı faturayı ayırt eder (17.10.2026). */
  document_no: z.string().max(40).nullable().optional().default(null),
  amount: z.number().min(0).nullable(),
  /** Tutar belgede yazıldığı haliyle ("=2200=", "2.200,00") */
  amount_raw: z.string().max(40).nullable().optional().default(null),
  /** "YALNIZ (Yazı ile)" satırı — rakamın bağımsız doğrulaması */
  amount_in_words: z.string().max(200).nullable().optional().default(null),
  /** Satır/kalem tutarı (TUTARI kolonu) */
  line_total: z.number().min(0).nullable().optional().default(null),
  /** ARA TOPLAM */
  subtotal: z.number().min(0).nullable().optional().default(null),
  /** G. TOPLAM / GENEL TOPLAM */
  grand_total: z.number().min(0).nullable().optional().default(null),
  /** El yazısı okunaksız / rakam birden çok okunabiliyorsa true */
  amount_ambiguous: z.boolean().optional().default(false),
  vat_rate: z.number().min(0).max(100).nullable(),
  vat_included: z.boolean().default(true),
  category: expenseCategoryEnum.default("other"),
  description: z.string().max(200).nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
});

export type ExpenseOcr = z.infer<typeof expenseOcrSchema>;

/** Structured-output shape: `check_notes` first, no regex/min/default constraints. */
export const expenseOutputSchema = z.object({
  check_notes: z.string(),
  is_expense: z.boolean(),
  rejection_reason: z.string().nullable(),
  vendor: z.string().nullable(),
  expense_date: z.string().nullable(),
  expense_date_raw: z.string().nullable(),
  document_no: z.string().nullable(),
  amount: z.number().nullable(),
  amount_raw: z.string().nullable(),
  amount_in_words: z.string().nullable(),
  line_total: z.number().nullable(),
  subtotal: z.number().nullable(),
  grand_total: z.number().nullable(),
  amount_ambiguous: z.boolean(),
  vat_rate: z.number().nullable(),
  vat_included: z.boolean(),
  category: expenseCategoryEnum,
  description: z.string().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
});
