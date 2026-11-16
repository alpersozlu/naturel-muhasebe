-- CreateTable
CREATE TABLE "MaviReceipt" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "store_code" TEXT,
    "date" DATE NOT NULL,
    "ref" TEXT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "is_refund" BOOLEAN NOT NULL DEFAULT false,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "upload_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaviReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftVoucherClaim" (
    "id" TEXT NOT NULL,
    "barcode" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "serial" TEXT,
    "mavi_receipt_id" TEXT,
    "receipt_ref" TEXT NOT NULL,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "used_date" DATE,
    "used_store_id" TEXT,
    "customer_name" TEXT,
    "status" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overridden_at" TIMESTAMP(3),
    "overridden_by" TEXT,
    "override_note" TEXT,
    "entered_by" TEXT,
    "entered_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftVoucherClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaviReceipt_store_id_ref_key" ON "MaviReceipt"("store_id", "ref");
CREATE INDEX "MaviReceipt_ref_idx" ON "MaviReceipt"("ref");
CREATE INDEX "MaviReceipt_date_idx" ON "MaviReceipt"("date");
CREATE UNIQUE INDEX "GiftVoucherClaim_barcode_key" ON "GiftVoucherClaim"("barcode");
CREATE INDEX "GiftVoucherClaim_receipt_ref_idx" ON "GiftVoucherClaim"("receipt_ref");
CREATE INDEX "GiftVoucherClaim_status_idx" ON "GiftVoucherClaim"("status");

-- AddForeignKey
ALTER TABLE "MaviReceipt" ADD CONSTRAINT "MaviReceipt_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftVoucherClaim" ADD CONSTRAINT "GiftVoucherClaim_mavi_receipt_id_fkey" FOREIGN KEY ("mavi_receipt_id") REFERENCES "MaviReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftVoucherClaim" ADD CONSTRAINT "GiftVoucherClaim_used_store_id_fkey" FOREIGN KEY ("used_store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
