-- CreateTable
CREATE TABLE "InvoicedExpenseBatch" (
    "id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "source_filename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "InvoicedExpenseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicedExpenseItem" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "raw_description" TEXT NOT NULL,
    "amount_original" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "fx_rate" DECIMAL(14,5),
    "fx_rate_date" DATE,
    "amount_try" DECIMAL(14,2) NOT NULL,
    "category" TEXT NOT NULL,
    "auto_category" TEXT NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "belongs_month" INTEGER,
    "note" TEXT,

    CONSTRAINT "InvoicedExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoicedExpenseBatch_period_year_period_month_idx" ON "InvoicedExpenseBatch"("period_year", "period_month");

-- CreateIndex
CREATE INDEX "InvoicedExpenseBatch_status_idx" ON "InvoicedExpenseBatch"("status");

-- CreateIndex
CREATE INDEX "InvoicedExpenseItem_batch_id_idx" ON "InvoicedExpenseItem"("batch_id");

-- CreateIndex
CREATE INDEX "InvoicedExpenseItem_category_idx" ON "InvoicedExpenseItem"("category");

-- AddForeignKey
ALTER TABLE "InvoicedExpenseItem" ADD CONSTRAINT "InvoicedExpenseItem_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "InvoicedExpenseBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
