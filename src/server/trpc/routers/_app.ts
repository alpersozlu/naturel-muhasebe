import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";
import { userRouter } from "./user";
import { userStoreAccessRouter } from "./userStoreAccess";
import { auditRouter } from "./audit";
import { uploadRouter } from "./upload";
import { cashAdvanceRouter } from "./cashAdvance";
import { corporatePurchaseRouter } from "./corporatePurchase";
import { verificationRouter } from "./verification";
import { dailyRecordRouter } from "./dailyRecord";
import { analyticsRouter } from "./analytics";
import { historyRouter } from "./history";
import { manualInvoiceRouter } from "./manualInvoice";
import { budgetRouter } from "./budget";
import { mergeGroupRouter } from "./mergeGroup";
import { nebimSalesRouter } from "./nebimSales";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "8.7",
    timestamp: new Date().toISOString(),
  })),
  brand: brandRouter,
  store: storeRouter,
  user: userRouter,
  userStoreAccess: userStoreAccessRouter,
  audit: auditRouter,
  upload: uploadRouter,
  cashAdvance: cashAdvanceRouter,
  corporatePurchase: corporatePurchaseRouter,
  verification: verificationRouter,
  dailyRecord: dailyRecordRouter,
  analytics: analyticsRouter,
  history: historyRouter,
  manualInvoice: manualInvoiceRouter,
  budget: budgetRouter,
  mergeGroup: mergeGroupRouter,
  nebimSales: nebimSalesRouter,
});

export type AppRouter = typeof appRouter;
