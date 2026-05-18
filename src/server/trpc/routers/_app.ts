import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";
import { userRouter } from "./user";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "3.3",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
  store: storeRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
