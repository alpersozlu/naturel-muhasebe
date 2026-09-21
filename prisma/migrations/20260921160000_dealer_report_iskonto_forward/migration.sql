-- Dealer day-end file is also handed to the discount-control system.
ALTER TABLE "DealerDailyReport"
  ADD COLUMN "iskonto_status" TEXT,
  ADD COLUMN "iskonto_detail" TEXT,
  ADD COLUMN "iskonto_job_id" TEXT,
  ADD COLUMN "iskonto_forwarded_at" TIMESTAMP(3);
