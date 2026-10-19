-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "masraf_category" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "masraf_category" TEXT;

-- CreateTable
CREATE TABLE "MasrafInvoice" (
    "id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "source_name" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ocr_status" TEXT NOT NULL DEFAULT 'pending',
    "ocr_error" TEXT,
    "ocr_json" JSONB,
    "vendor" TEXT,
    "document_no" TEXT,
    "expense_date" DATE,
    "amount_original" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "fx_rate" DECIMAL(14,5),
    "amount_try" DECIMAL(14,2),
    "vat_rate" DECIMAL(5,2),
    "description" TEXT,
    "ocr_category" TEXT,
    "category" TEXT,
    "auto_category" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "belongs_month" INTEGER,
    "classification" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decision_note" TEXT,
    "matched_expense_id" TEXT,
    "match_method" TEXT,
    "match_score" DECIMAL(4,3),
    "duplicate_of_id" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "MasrafInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasrafManualEntry" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "store_code" TEXT NOT NULL,
    "row_key" TEXT NOT NULL,
    "amount_try" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasrafManualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MasrafInvoice_file_hash_key" ON "MasrafInvoice"("file_hash");

-- CreateIndex
CREATE INDEX "MasrafInvoice_period_year_period_month_idx" ON "MasrafInvoice"("period_year", "period_month");

-- CreateIndex
CREATE INDEX "MasrafInvoice_classification_idx" ON "MasrafInvoice"("classification");

-- CreateIndex
CREATE INDEX "MasrafInvoice_matched_expense_id_idx" ON "MasrafInvoice"("matched_expense_id");

-- CreateIndex
CREATE INDEX "MasrafInvoice_deleted_at_idx" ON "MasrafInvoice"("deleted_at");

-- CreateIndex
CREATE INDEX "MasrafManualEntry_brand_period_year_idx" ON "MasrafManualEntry"("brand", "period_year");

-- CreateIndex
CREATE UNIQUE INDEX "MasrafManualEntry_brand_period_year_period_month_store_code_key" ON "MasrafManualEntry"("brand", "period_year", "period_month", "store_code", "row_key");

-- AddForeignKey
ALTER TABLE "MasrafInvoice" ADD CONSTRAINT "MasrafInvoice_matched_expense_id_fkey" FOREIGN KEY ("matched_expense_id") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
