-- CreateEnum
CREATE TYPE "PayrollPayMethod" AS ENUM ('garanti', 'ziraat', 'cash');

-- CreateEnum
CREATE TYPE "PayrollCommissionProfile" AS ENUM ('mavi_asistan', 'mavi_mudur', 'mavi_vice', 'deri_asistan', 'deri_mudur', 'none');

-- CreateEnum
CREATE TYPE "PayrollEmployeeStatus" AS ENUM ('active', 'inactive', 'left');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "PayrollEntryKind" AS ENUM ('advance', 'payment', 'deduction', 'addition');

-- CreateEnum
CREATE TYPE "PayrollChannel" AS ENUM ('garanti', 'ziraat', 'cash', 'other');

-- CreateEnum
CREATE TYPE "PayrollBatchKind" AS ENUM ('advance', 'payment1', 'payment2', 'single');

-- CreateEnum
CREATE TYPE "PayrollBatchStatus" AS ENUM ('prepared', 'sent', 'void');

-- CreateTable
CREATE TABLE "PayrollEmployee" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "commission_profile" "PayrollCommissionProfile" NOT NULL DEFAULT 'none',
    "base_salary" DECIMAL(14,2) NOT NULL,
    "pay_method" "PayrollPayMethod" NOT NULL DEFAULT 'garanti',
    "bank_account_name" TEXT,
    "bank_branch_code" TEXT,
    "bank_account_no" TEXT,
    "iban" TEXT,
    "is_registered" BOOLEAN NOT NULL DEFAULT true,
    "is_gross_minimum" BOOLEAN NOT NULL DEFAULT false,
    "perfume_eligible" BOOLEAN NOT NULL DEFAULT false,
    "garment_eligible" BOOLEAN NOT NULL DEFAULT false,
    "paid_month_early" BOOLEAN NOT NULL DEFAULT false,
    "nebim_name" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_date" DATE,
    "end_date" DATE,
    "status" "PayrollEmployeeStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "PayrollEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollStoreMonth" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "revenue" DECIMAL(14,2),
    "target" DECIMAL(14,2),
    "revenue_source" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollStoreMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "commission_profile" "PayrollCommissionProfile" NOT NULL,
    "base_salary" DECIMAL(14,2) NOT NULL,
    "overtime_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtime_note" TEXT,
    "own_revenue_nd" DECIMAL(14,2),
    "own_revenue_denim" DECIMAL(14,2),
    "own_revenue" DECIMAL(14,2),
    "own_target" DECIMAL(14,2),
    "achievement_accepted" DECIMAL(7,4),
    "commission_override" DECIMAL(14,2),
    "commission_note" TEXT,
    "perfume_units" INTEGER NOT NULL DEFAULT 0,
    "garment_units" INTEGER NOT NULL DEFAULT 0,
    "top_seller" BOOLEAN NOT NULL DEFAULT false,
    "extra_premium" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "extra_premium_note" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "PayrollEntryKind" NOT NULL,
    "category" TEXT,
    "channel" "PayrollChannel",
    "entry_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "batch_id" TEXT,
    "loan_id" TEXT,
    "cash_advance_id" TEXT,
    "created_by" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "void_note" TEXT,
    "voided_by" TEXT,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollBatch" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "kind" "PayrollBatchKind" NOT NULL,
    "channel" "PayrollChannel" NOT NULL,
    "status" "PayrollBatchStatus" NOT NULL DEFAULT 'prepared',
    "pay_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "count" INTEGER NOT NULL,
    "file_name" TEXT,
    "created_by" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "PayrollBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLoan" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "opening_repaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loan_date" DATE,
    "note" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollEmployee_store_id_idx" ON "PayrollEmployee"("store_id");

-- CreateIndex
CREATE INDEX "PayrollEmployee_status_idx" ON "PayrollEmployee"("status");

-- CreateIndex
CREATE INDEX "PayrollEmployee_deleted_at_idx" ON "PayrollEmployee"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_year_month_key" ON "PayrollPeriod"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollStoreMonth_period_id_store_id_key" ON "PayrollStoreMonth"("period_id", "store_id");

-- CreateIndex
CREATE INDEX "PayrollLine_store_id_idx" ON "PayrollLine"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_period_id_employee_id_key" ON "PayrollLine"("period_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_cash_advance_id_key" ON "PayrollEntry"("cash_advance_id");

-- CreateIndex
CREATE INDEX "PayrollEntry_line_id_idx" ON "PayrollEntry"("line_id");

-- CreateIndex
CREATE INDEX "PayrollEntry_period_id_idx" ON "PayrollEntry"("period_id");

-- CreateIndex
CREATE INDEX "PayrollEntry_employee_id_idx" ON "PayrollEntry"("employee_id");

-- CreateIndex
CREATE INDEX "PayrollEntry_batch_id_idx" ON "PayrollEntry"("batch_id");

-- CreateIndex
CREATE INDEX "PayrollBatch_period_id_idx" ON "PayrollBatch"("period_id");

-- CreateIndex
CREATE INDEX "PayrollLoan_employee_id_idx" ON "PayrollLoan"("employee_id");

-- AddForeignKey
ALTER TABLE "PayrollEmployee" ADD CONSTRAINT "PayrollEmployee_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollStoreMonth" ADD CONSTRAINT "PayrollStoreMonth_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollStoreMonth" ADD CONSTRAINT "PayrollStoreMonth_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "PayrollLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "PayrollBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "PayrollLoan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollBatch" ADD CONSTRAINT "PayrollBatch_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLoan" ADD CONSTRAINT "PayrollLoan_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

