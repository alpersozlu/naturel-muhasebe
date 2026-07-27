-- CreateTable
CREATE TABLE "NebimVoucherTxn" (
    "id" TEXT NOT NULL,
    "company_code" INTEGER NOT NULL,
    "payment_line_id" TEXT NOT NULL,
    "payment_no" TEXT,
    "txn_date" DATE NOT NULL,
    "txn_time" TEXT,
    "store_id" TEXT,
    "nebim_store_code" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "customer_code" TEXT,
    "customer_name" TEXT,
    "serial" TEXT,
    "invoice_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NebimVoucherTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NebimVoucher" (
    "id" TEXT NOT NULL,
    "company_code" INTEGER NOT NULL,
    "serial" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "used_amount" DECIMAL(14,2) NOT NULL,
    "first_valid" DATE,
    "last_valid" DATE,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "nebim_created" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NebimVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NebimVoucherTxn_txn_date_idx" ON "NebimVoucherTxn"("txn_date");

-- CreateIndex
CREATE INDEX "NebimVoucherTxn_serial_idx" ON "NebimVoucherTxn"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "NebimVoucherTxn_company_code_payment_line_id_key" ON "NebimVoucherTxn"("company_code", "payment_line_id");

-- CreateIndex
CREATE INDEX "NebimVoucher_last_valid_idx" ON "NebimVoucher"("last_valid");

-- CreateIndex
CREATE UNIQUE INDEX "NebimVoucher_company_code_serial_key" ON "NebimVoucher"("company_code", "serial");

-- AddForeignKey
ALTER TABLE "NebimVoucherTxn" ADD CONSTRAINT "NebimVoucherTxn_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
