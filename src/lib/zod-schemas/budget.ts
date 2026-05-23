import { z } from "zod";

export const BUDGET_SCOPES = ["total", "category"] as const;
export const BUDGET_MODES = ["amount", "ratio"] as const;
export const BUDGET_PERIODS = ["monthly", "yearly", "custom"] as const;

export const EXPENSE_CATEGORIES = [
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
  "marketing",
  "other",
] as const;

const baseFields = {
  name: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) =>
      v && typeof v === "string" && v.trim() ? v.trim() : undefined
    ),
  store_id: z
    .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v && typeof v === "string" ? v : undefined)),
  scope: z.enum(BUDGET_SCOPES),
  category: z
    .union([z.enum(EXPENSE_CATEGORIES), z.null(), z.undefined()])
    .transform((v) => (v ?? undefined)),
  mode: z.enum(BUDGET_MODES),
  amount_try: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : undefined;
    }),
  ratio_pct: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return undefined;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : undefined;
    }),
  period: z.enum(BUDGET_PERIODS),
  period_start: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v && typeof v === "string" && v.trim() ? v : undefined)),
  period_end: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v && typeof v === "string" && v.trim() ? v : undefined)),
  alert_pct: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return 80;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : 80;
    }),
  notes: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) =>
      v && typeof v === "string" && v.trim() ? v.trim() : undefined
    ),
};

export const budgetLimitFormSchema = z
  .object(baseFields)
  .superRefine((val, ctx) => {
    if (val.scope === "category" && !val.category) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Kategori limiti için kategori seçilmeli",
      });
    }
    if (val.mode === "amount" && (val.amount_try === undefined || val.amount_try <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount_try"],
        message: "Tutar girilmeli (TL, pozitif)",
      });
    }
    if (val.mode === "ratio") {
      if (val.ratio_pct === undefined || val.ratio_pct <= 0 || val.ratio_pct > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["ratio_pct"],
          message: "Yüzde 0-100 arası olmalı",
        });
      }
    }
    if (val.period === "custom") {
      if (!val.period_start || !val.period_end) {
        ctx.addIssue({
          code: "custom",
          path: ["period_start"],
          message: "Özel dönemde başlangıç ve bitiş tarihleri zorunlu",
        });
      }
    }
    if (val.alert_pct < 1 || val.alert_pct > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["alert_pct"],
        message: "Uyarı yüzdesi 1-100 arası olmalı",
      });
    }
  });

export const budgetLimitCreateSchema = budgetLimitFormSchema;
export const budgetLimitUpdateSchema = z
  .object({
    id: z.string().uuid(),
    is_active: z.boolean().optional(),
    ...baseFields,
  })
  .superRefine((val, ctx) => {
    if (val.scope === "category" && !val.category) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Kategori limiti için kategori seçilmeli",
      });
    }
  });
export const budgetLimitIdSchema = z.object({ id: z.string().uuid() });

export type BudgetLimitFormInput = z.input<typeof budgetLimitFormSchema>;
export type BudgetLimitFormOutput = z.output<typeof budgetLimitFormSchema>;
