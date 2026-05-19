-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'z_report';

-- CreateTable
CREATE TABLE "ZReport" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "report_no" TEXT,
    "report_date" DATE,
    "gross_sales" DECIMAL(14,2),
    "net_sales" DECIMAL(14,2),
    "cash_sales" DECIMAL(14,2),
    "credit_card_sales" DECIMAL(14,2),
    "refund_amount" DECIMAL(14,2),
    "vat_total" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "gross_sales_try" DECIMAL(14,2),
    "net_sales_try" DECIMAL(14,2),
    "cash_sales_try" DECIMAL(14,2),
    "credit_card_sales_try" DECIMAL(14,2),
    "content_fingerprint" TEXT,
    "user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualInvoice" (
    "id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "invoice_no" TEXT,
    "invoice_date" DATE,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZReport_upload_id_key" ON "ZReport"("upload_id");

-- CreateIndex
CREATE INDEX "ZReport_daily_record_id_idx" ON "ZReport"("daily_record_id");

-- CreateIndex
CREATE INDEX "ZReport_daily_record_id_content_fingerprint_idx" ON "ZReport"("daily_record_id", "content_fingerprint");

-- CreateIndex
CREATE INDEX "ManualInvoice_daily_record_id_idx" ON "ManualInvoice"("daily_record_id");

-- AddForeignKey
ALTER TABLE "ZReport" ADD CONSTRAINT "ZReport_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZReport" ADD CONSTRAINT "ZReport_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualInvoice" ADD CONSTRAINT "ManualInvoice_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualInvoice" ADD CONSTRAINT "ManualInvoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
