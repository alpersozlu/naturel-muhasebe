import { z } from "zod";
import { router, adminProcedure } from "../trpc";

export const auditRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 })
    )
    .query(({ ctx, input }) =>
      ctx.prisma.auditLog.findMany({
        take: input.limit,
        orderBy: { created_at: "desc" },
        include: {
          user: { select: { email: true, full_name: true } },
        },
      })
    ),
});
