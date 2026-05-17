import { router, publicProcedure } from "../trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "2",
    timestamp: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;
