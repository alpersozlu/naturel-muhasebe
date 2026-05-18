import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";
import { userRouter } from "./user";
import { userStoreAccessRouter } from "./userStoreAccess";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "3.4",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
  store: storeRouter,
  user: userRouter,
  userStoreAccess: userStoreAccessRouter,
});

export type AppRouter = typeof appRouter;
