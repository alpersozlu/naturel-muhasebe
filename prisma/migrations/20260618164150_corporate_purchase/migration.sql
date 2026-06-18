-- CreateEnum
CREATE TYPE "CorporatePurchaseType" AS ENUM ('corporate', 'management');

-- CreateTable
CREATE TABLE "CorporatePurchase" (
    "id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "type" "CorporatePurchaseType" NOT NULL,
    "company_name" TEXT,
    "person_name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporatePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporatePurchase_daily_record_id_idx" ON "CorporatePurchase"("daily_record_id");

-- CreateIndex
CREATE INDEX "CorporatePurchase_type_idx" ON "CorporatePurchase"("type");

-- AddForeignKey
ALTER TABLE "CorporatePurchase" ADD CONSTRAINT "CorporatePurchase_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
