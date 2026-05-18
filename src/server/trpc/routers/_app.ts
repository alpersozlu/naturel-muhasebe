import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";
import { userRouter } from "./user";
import { userStoreAccessRouter } from "./userStoreAccess";
import { auditRouter } from "./audit";
import { uploadRouter } from "./upload";
import { cashAdvanceRouter } from "./cashAdvance";
import { verificationRouter } from "./verification";
import { dailyRecordRouter } from "./dailyRecord";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "5",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
  store: storeRouter,
  user: userRouter,
  userStoreAccess: userStoreAccessRouter,
  audit: auditRouter,
  upload: uploadRouter,
  cashAdvance: cashAdvanceRouter,
  verification: verificationRouter,
  dailyRecord: dailyRecordRouter,
});

export type AppRouter = typeof appRouter;
