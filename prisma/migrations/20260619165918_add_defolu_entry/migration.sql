-- CreateTable
CREATE TABLE "DefoluEntry" (
    "id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "store_code" TEXT NOT NULL,
    "amount_try" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'indirim-kontrol',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefoluEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefoluEntry_period_year_idx" ON "DefoluEntry"("period_year");

-- CreateIndex
CREATE UNIQUE INDEX "DefoluEntry_period_year_period_month_store_code_key" ON "DefoluEntry"("period_year", "period_month", "store_code");
