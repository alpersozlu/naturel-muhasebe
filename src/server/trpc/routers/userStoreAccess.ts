import { TRPCError } from "@trpc/server";
import { router } from "../trpc";
import { withAudit } from "../middleware/audit";

const accessAdmin = withAudit("UserStoreAccess");
import {
  assignSchema,
  unassignSchema,
  listForStoreSchema,
} from "@/lib/zod-schemas/user-store-access";

export const userStoreAccessRouter = router({
  listForStore: accessAdmin.input(listForStoreSchema).query(({ ctx, input }) =>
    ctx.prisma.userStoreAccess.findMany({
      where: { store_id: input.store_id },
      include: { user: true },
      orderBy: { user: { full_name: "asc" } },
    })
  ),

  assign: accessAdmin.input(assignSchema).mutation(async ({ ctx, input }) => {
    // Hem user hem store geçerli olmalı, store silinmiş olmamalı
    const [user, store] = await Promise.all([
      ctx.prisma.user.findUnique({ where: { id: input.user_id } }),
      ctx.prisma.store.findUnique({ where: { id: input.store_id } }),
    ]);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Kullanıcı yok" });
    if (!store || store.deleted_at) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Mağaza yok" });
    }
    if (input.role === "admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Admin rolü mağazaya atanmaz",
      });
    }
    return ctx.prisma.userStoreAccess.upsert({
      where: {
        user_id_store_id: { user_id: input.user_id, store_id: input.store_id },
      },
      update: { role: input.role },
      create: {
        user_id: input.user_id,
        store_id: input.store_id,
        role: input.role,
      },
    });
  }),

  unassign: accessAdmin.input(unassignSchema).mutation(({ ctx, input }) =>
    ctx.prisma.userStoreAccess.delete({
      where: {
        user_id_store_id: { user_id: input.user_id, store_id: input.store_id },
      },
    })
  ),
});
