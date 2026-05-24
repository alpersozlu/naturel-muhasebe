-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'dealer_daily_report';

-- CreateTable
CREATE TABLE "DealerDailyReport" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'sap',
    "store_code" TEXT,
    "report_date" DATE NOT NULL,
    "net_sales_try" DECIMAL(14,2) NOT NULL,
    "loyalty_try" DECIMAL(14,2) NOT NULL,
    "gift_card_try" DECIMAL(14,2),
    "transaction_count" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "refund_count" INTEGER NOT NULL,
    "source_date_min" DATE,
    "source_date_max" DATE,
    "content_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealerDailyReport_upload_id_key" ON "DealerDailyReport"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "DealerDailyReport_daily_record_id_key" ON "DealerDailyReport"("daily_record_id");

-- CreateIndex
CREATE INDEX "DealerDailyReport_daily_record_id_idx" ON "DealerDailyReport"("daily_record_id");

-- CreateIndex
CREATE INDEX "DealerDailyReport_report_date_idx" ON "DealerDailyReport"("report_date");

-- AddForeignKey
ALTER TABLE "DealerDailyReport" ADD CONSTRAINT "DealerDailyReport_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerDailyReport" ADD CONSTRAINT "DealerDailyReport_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
