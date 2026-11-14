-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'cheque';

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT,
    "daily_record_id" TEXT NOT NULL,
    "bank_name" TEXT,
    "branch" TEXT,
    "cheque_no" TEXT,
    "drawer_name" TEXT,
    "payee_name" TEXT,
    "cheque_date" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_upload_id_key" ON "Cheque"("upload_id");

-- CreateIndex
CREATE INDEX "Cheque_daily_record_id_idx" ON "Cheque"("daily_record_id");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
