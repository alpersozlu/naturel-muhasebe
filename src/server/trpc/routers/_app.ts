import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "3",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
});

export type AppRouter = typeof appRouter;
