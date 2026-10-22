import { router, publicProcedure } from "../trpc";
import { brandRouter } from "./brand";
import { storeRouter } from "./store";
import { userRouter } from "./user";
import { authRouter } from "./auth";
import { userStoreAccessRouter } from "./userStoreAccess";
import { auditRouter } from "./audit";
import { uploadRouter } from "./upload";
import { cashAdvanceRouter } from "./cashAdvance";
import { corporatePurchaseRouter } from "./corporatePurchase";
import { invoicedExpenseRouter } from "./invoicedExpense";
import { verificationRouter } from "./verification";
import { dailyRecordRouter } from "./dailyRecord";
import { analyticsRouter } from "./analytics";
import { historyRouter } from "./history";
import { manualInvoiceRouter } from "./manualInvoice";
import { budgetRouter } from "./budget";
import { mergeGroupRouter } from "./mergeGroup";
import { nebimSalesRouter } from "./nebimSales";
import { meritRouter } from "./merit";
import { peopleCountRouter } from "./peopleCount";
import { payrollRouter } from "./payroll";
import { pdfSelfTest } from "@/server/services/payroll/performance";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    phase: "8.7",
    timestamp: new Date().toISOString(),
  })),
  /**
   * Deploy smoke test for the one capability that breaks ONLY in the
   * serverless bundle (pdf.js — see performance.ts). Reads a PDF built in
   * memory; touches no data, needs no sign-in.
   */
  healthPdf: publicProcedure.query(() => pdfSelfTest()),
  brand: brandRouter,
  store: storeRouter,
  user: userRouter,
  auth: authRouter,
  userStoreAccess: userStoreAccessRouter,
  audit: auditRouter,
  upload: uploadRouter,
  cashAdvance: cashAdvanceRouter,
  corporatePurchase: corporatePurchaseRouter,
  invoicedExpense: invoicedExpenseRouter,
  verification: verificationRouter,
  dailyRecord: dailyRecordRouter,
  analytics: analyticsRouter,
  history: historyRouter,
  manualInvoice: manualInvoiceRouter,
  budget: budgetRouter,
  mergeGroup: mergeGroupRouter,
  nebimSales: nebimSalesRouter,
  merit: meritRouter,
  peopleCount: peopleCountRouter,
  payroll: payrollRouter,
});

export type AppRouter = typeof appRouter;
