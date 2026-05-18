import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "3.2",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
  store: storeRouter,
});

export type AppRouter = typeof appRouter;
