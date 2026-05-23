import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import {
  budgetLimitCreateSchema,
  budgetLimitUpdateSchema,
  budgetLimitIdSchema,
} from "@/lib/zod-schemas/budget";
import { computeBudgetStatus } from "@/server/services/budget/status";

function toDateOnly(s: string | undefined): Date | null {
  if (!s) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

export const budgetRouter = router({
  /** Tüm aktif limitleri durumlarıyla birlikte döner (en yeni önce). */
  list: adminProcedure.query(async ({ ctx }) => {
    const limits = await ctx.prisma.budgetLimit.findMany({
      where: { is_active: true },
      include: {
        store: { select: { name: true, brand: { select: { name: true } } } },
      },
      orderBy: { created_at: "desc" },
    });
    const now = new Date();
    return Promise.all(limits.map((l) => computeBudgetStatus(ctx.prisma, l, now)));
  }),

  /** Yeni limit ekle. */
  create: adminProcedure
    .input(budgetLimitCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.prisma.budgetLimit.create({
        data: {
          name: input.name ?? null,
          store_id: input.store_id ?? null,
          scope: input.scope,
          category: input.scope === "category" ? input.category ?? null : null,
          mode: input.mode,
          amount_try: input.mode === "amount" ? input.amount_try ?? null : null,
          ratio_pct: input.mode === "ratio" ? input.ratio_pct ?? null : null,
          period: input.period,
          period_start:
            input.period === "custom" ? toDateOnly(input.period_start) : null,
          period_end:
            input.period === "custom" ? toDateOnly(input.period_end) : null,
          alert_pct: input.alert_pct,
          notes: input.notes ?? null,
          created_by: ctx.user.id,
        },
      });
      return created;
    }),

  /** Mevcut limiti güncelle (is_active dahil — deactivate için). */
  update: adminProcedure
    .input(budgetLimitUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.budgetLimit.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Limit bulunamadı" });
      }
      return ctx.prisma.budgetLimit.update({
        where: { id: input.id },
        data: {
          name: input.name ?? null,
          store_id: input.store_id ?? null,
          scope: input.scope,
          category: input.scope === "category" ? input.category ?? null : null,
          mode: input.mode,
          amount_try: input.mode === "amount" ? input.amount_try ?? null : null,
          ratio_pct: input.mode === "ratio" ? input.ratio_pct ?? null : null,
          period: input.period,
          period_start:
            input.period === "custom" ? toDateOnly(input.period_start) : null,
          period_end:
            input.period === "custom" ? toDateOnly(input.period_end) : null,
          alert_pct: input.alert_pct,
          notes: input.notes ?? null,
          ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        },
      });
    }),

  /** Limiti kalıcı sil. */
  delete: adminProcedure
    .input(budgetLimitIdSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.budgetLimit.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
