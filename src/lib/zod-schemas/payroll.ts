import { z } from "zod";

export const payMethodEnum = z.enum(["garanti", "ziraat", "cash"]);
export const commissionProfileEnum = z.enum([
  "mavi_asistan",
  "mavi_mudur",
  "mavi_vice",
  "deri_asistan",
  "deri_mudur",
  "none",
]);
export const employeeStatusEnum = z.enum(["active", "inactive", "left"]);
export const entryKindEnum = z.enum(["advance", "payment", "deduction", "addition"]);
export const channelEnum = z.enum(["garanti", "ziraat", "cash", "other"]);
export const batchKindEnum = z.enum(["advance", "payment1", "payment2", "single"]);

const money = z.number().finite().min(0).max(100_000_000);
const moneyNullable = money.nullable();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v));

export const periodKeySchema = z.object({
  year: z.number().int().min(2024).max(2100),
  month: z.number().int().min(1).max(12),
});

export const employeeCreateSchema = z.object({
  store_id: z.string().uuid(),
  full_name: z.string().trim().min(2, "Ad soyad gir").max(80),
  position: z.string().trim().min(2).max(40),
  commission_profile: commissionProfileEnum,
  base_salary: money,
  pay_method: payMethodEnum,
  bank_account_name: text(80),
  bank_branch_code: text(10),
  bank_account_no: text(20),
  iban: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null))
    .refine((v) => v === null || /^TR\d{24}$/.test(v), "IBAN TR + 24 rakam olmalı"),
  is_registered: z.boolean().default(true),
  is_gross_minimum: z.boolean().default(false),
  perfume_eligible: z.boolean().default(false),
  garment_eligible: z.boolean().default(false),
  paid_month_early: z.boolean().default(false),
  nebim_name: text(80),
  aliases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  start_date: dateStr.nullable().optional(),
  status: employeeStatusEnum.default("active"),
  notes: text(2000),
});

export const employeeUpdateSchema = employeeCreateSchema.partial().extend({
  id: z.string().uuid(),
});

export const employeeLeaveSchema = z.object({
  id: z.string().uuid(),
  end_date: dateStr,
  note: text(500),
});

export const lineUpdateSchema = z.object({
  id: z.string().uuid(),
  base_salary: money.optional(),
  overtime_hours: z.number().min(0).max(400).optional(),
  overtime_note: text(500),
  own_revenue_nd: moneyNullable.optional(),
  own_revenue_denim: moneyNullable.optional(),
  own_revenue: moneyNullable.optional(),
  own_target: moneyNullable.optional(),
  achievement_accepted: z.number().min(0).max(5).nullable().optional(),
  commission_override: moneyNullable.optional(),
  commission_note: text(500),
  perfume_units: z.number().int().min(0).max(10000).optional(),
  garment_units: z.number().int().min(0).max(10000).optional(),
  top_seller: z.boolean().optional(),
  extra_premium: money.optional(),
  extra_premium_note: text(500),
  note: text(4000),
});

export const storeMonthUpsertSchema = z.object({
  period_id: z.string().uuid(),
  store_id: z.string().uuid(),
  revenue: moneyNullable.optional(),
  target: moneyNullable.optional(),
  notes: text(500),
});

export const entryCreateSchema = z
  .object({
    line_id: z.string().uuid(),
    kind: entryKindEnum,
    category: text(40),
    channel: channelEnum.optional().nullable(),
    entry_date: dateStr,
    amount: z.number().finite().positive("Tutar 0'dan büyük olmalı").max(100_000_000),
    note: text(1000),
    reference: text(200),
    loan_id: z.string().uuid().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if ((v.kind === "deduction" || v.kind === "addition") && !v.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Kesinti ve ek hak ediş için not zorunlu (ne, kim, ne zaman)",
      });
    }
  });

export const entryVoidSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(3, "İptal nedeni yaz").max(500),
});

export const batchPreviewSchema = z.object({
  period_id: z.string().uuid(),
  kind: batchKindEnum,
  channel: z.enum(["garanti", "ziraat", "cash"]),
});

export const batchCreateSchema = z.object({
  period_id: z.string().uuid(),
  kind: batchKindEnum,
  channel: z.enum(["garanti", "ziraat", "cash"]),
  pay_date: dateStr,
  title: text(120),
  items: z
    .array(
      z.object({
        line_id: z.string().uuid(),
        amount: z.number().finite().positive().max(100_000_000),
      })
    )
    .min(1, "En az bir kişi seç"),
  mark_sent: z.boolean().default(false),
});

export const batchStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["sent", "void"]),
  note: text(500),
});

export const loanCategoryEnum = z.enum(["loan", "work_permit"]);

export const loanCreateSchema = z.object({
  employee_id: z.string().uuid(),
  category: loanCategoryEnum.default("loan"),
  principal: z.number().finite().positive().max(100_000_000),
  opening_repaid: money.default(0),
  installment: money.nullable().optional(),
  auto_deduct: z.boolean().default(false),
  start_year: z.number().int().min(2024).max(2100).nullable().optional(),
  start_month: z.number().int().min(1).max(12).nullable().optional(),
  loan_date: dateStr.nullable().optional(),
  note: text(500),
});

export const loanUpdateSchema = z.object({
  id: z.string().uuid(),
  installment: money.nullable().optional(),
  auto_deduct: z.boolean().optional(),
  start_year: z.number().int().min(2024).max(2100).nullable().optional(),
  start_month: z.number().int().min(1).max(12).nullable().optional(),
  note: text(500),
  closed: z.boolean().optional(),
});

export const importAccountsSchema = z.object({
  file_base64: z.string().min(10).max(30_000_000),
});

export const cashAdvanceLinkSchema = z.object({
  line_id: z.string().uuid(),
  cash_advance_id: z.string().uuid(),
});

export const idSchema = z.object({ id: z.string().uuid() });
export const periodIdSchema = z.object({ period_id: z.string().uuid() });
