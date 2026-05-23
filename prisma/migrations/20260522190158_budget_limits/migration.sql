-- CreateEnum
CREATE TYPE "BudgetScope" AS ENUM ('total', 'category');

-- CreateEnum
CREATE TYPE "BudgetMode" AS ENUM ('amount', 'ratio');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('monthly', 'yearly', 'custom');

-- CreateTable
CREATE TABLE "BudgetLimit" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "store_id" TEXT,
    "scope" "BudgetScope" NOT NULL,
    "category" "ExpenseCategory",
    "mode" "BudgetMode" NOT NULL,
    "amount_try" DECIMAL(14,2),
    "ratio_pct" DECIMAL(5,2),
    "period" "BudgetPeriod" NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "alert_pct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetLimit_store_id_idx" ON "BudgetLimit"("store_id");

-- CreateIndex
CREATE INDEX "BudgetLimit_is_active_idx" ON "BudgetLimit"("is_active");

-- AddForeignKey
ALTER TABLE "BudgetLimit" ADD CONSTRAINT "BudgetLimit_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
