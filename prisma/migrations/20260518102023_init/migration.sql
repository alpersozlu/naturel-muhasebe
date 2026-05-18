-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'store_manager', 'cashier', 'sales_rep');

-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('bank_receipt', 'pos_slip', 'store_summary', 'expense', 'cash_advance');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'processing', 'parsed', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "DailyRecordStatus" AS ENUM ('draft', 'pending', 'approved', 'locked');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('match', 'mismatch', 'manual_override');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'USD', 'EUR', 'GBP');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('rent', 'electricity', 'water', 'internet', 'stationery', 'cleaning', 'maintenance', 'salary', 'bonus', 'supplies', 'marketing', 'other');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'cashier',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStoreAccess" (
    "user_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "UserStoreAccess_pkey" PRIMARY KEY ("user_id","store_id")
);

-- CreateTable
CREATE TABLE "DailyRecord" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DailyRecordStatus" NOT NULL DEFAULT 'draft',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "type" "UploadType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_ocr_json" JSONB,
    "parsed_data_json" JSONB,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSlip" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "bank_name" TEXT,
    "terminal_no" TEXT,
    "slip_date" DATE,
    "sales_count" INTEGER,
    "sales_amount" DECIMAL(14,2),
    "refund_count" INTEGER,
    "refund_amount" DECIMAL(14,2),
    "net_amount" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "net_amount_try" DECIMAL(14,2),
    "fx_rate_used" DECIMAL(10,4),
    "user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSummary" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "sales_total" DECIMAL(14,2),
    "cash_sales" DECIMAL(14,2),
    "credit_card_total" DECIMAL(14,2),
    "loyalty_points_total" DECIMAL(14,2),
    "opening_balance" DECIMAL(14,2),
    "closing_balance" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "sales_total_try" DECIMAL(14,2),
    "cash_sales_try" DECIMAL(14,2),
    "credit_card_total_try" DECIMAL(14,2),
    "loyalty_points_total_try" DECIMAL(14,2),
    "fx_rate_used" DECIMAL(10,4),
    "user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReceipt" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT,
    "daily_record_id" TEXT NOT NULL,
    "bank_id" TEXT,
    "bank_name" TEXT,
    "iban" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "deposit_date" DATE NOT NULL,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT,
    "daily_record_id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "vendor" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "expense_date" DATE NOT NULL,
    "description" TEXT,
    "employee_id" TEXT,
    "vat_rate" DECIMAL(5,2),
    "vat_included" BOOLEAN NOT NULL DEFAULT true,
    "user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "amount_try" DECIMAL(14,2) NOT NULL,
    "fx_rate_used" DECIMAL(10,4),
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT,
    "receipt_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "daily_record_id" TEXT NOT NULL,
    "expected_total" DECIMAL(14,2) NOT NULL,
    "actual_total" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "notes" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commission_rate_default" DECIMAL(5,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "date" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate_to_try" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'TCMB',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date","currency")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Brand_deleted_at_idx" ON "Brand"("deleted_at");

-- CreateIndex
CREATE INDEX "Store_brand_id_idx" ON "Store"("brand_id");

-- CreateIndex
CREATE INDEX "Store_deleted_at_idx" ON "Store"("deleted_at");

-- CreateIndex
CREATE INDEX "UserStoreAccess_store_id_idx" ON "UserStoreAccess"("store_id");

-- CreateIndex
CREATE INDEX "DailyRecord_date_idx" ON "DailyRecord"("date");

-- CreateIndex
CREATE INDEX "DailyRecord_status_idx" ON "DailyRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecord_store_id_date_key" ON "DailyRecord"("store_id", "date");

-- CreateIndex
CREATE INDEX "Upload_daily_record_id_idx" ON "Upload"("daily_record_id");

-- CreateIndex
CREATE INDEX "Upload_type_idx" ON "Upload"("type");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PosSlip_upload_id_key" ON "PosSlip"("upload_id");

-- CreateIndex
CREATE INDEX "PosSlip_daily_record_id_idx" ON "PosSlip"("daily_record_id");

-- CreateIndex
CREATE INDEX "PosSlip_bank_name_idx" ON "PosSlip"("bank_name");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSummary_upload_id_key" ON "StoreSummary"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSummary_daily_record_id_key" ON "StoreSummary"("daily_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "BankReceipt_upload_id_key" ON "BankReceipt"("upload_id");

-- CreateIndex
CREATE INDEX "BankReceipt_daily_record_id_idx" ON "BankReceipt"("daily_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_upload_id_key" ON "Expense"("upload_id");

-- CreateIndex
CREATE INDEX "Expense_daily_record_id_idx" ON "Expense"("daily_record_id");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "CashAdvance_daily_record_id_idx" ON "CashAdvance"("daily_record_id");

-- CreateIndex
CREATE INDEX "CashAdvance_employee_id_idx" ON "CashAdvance"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_daily_record_id_key" ON "Verification"("daily_record_id");

-- CreateIndex
CREATE INDEX "Verification_status_idx" ON "Verification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_name_key" ON "Bank"("name");

-- CreateIndex
CREATE INDEX "Bank_is_active_idx" ON "Bank"("is_active");

-- CreateIndex
CREATE INDEX "FxRate_currency_idx" ON "FxRate"("currency");

-- CreateIndex
CREATE INDEX "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_type_entity_id_idx" ON "AuditLog"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoreAccess" ADD CONSTRAINT "UserStoreAccess_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoreAccess" ADD CONSTRAINT "UserStoreAccess_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSlip" ADD CONSTRAINT "PosSlip_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSlip" ADD CONSTRAINT "PosSlip_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSummary" ADD CONSTRAINT "StoreSummary_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSummary" ADD CONSTRAINT "StoreSummary_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_daily_record_id_fkey" FOREIGN KEY ("daily_record_id") REFERENCES "DailyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
