-- CreateTable
CREATE TABLE "OutletStockItem" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "scanned_at" DATE NOT NULL,
    "batch" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletStockItem_store_id_barcode_idx" ON "OutletStockItem"("store_id", "barcode");

-- CreateIndex
CREATE INDEX "OutletStockItem_batch_idx" ON "OutletStockItem"("batch");

-- AddForeignKey
ALTER TABLE "OutletStockItem" ADD CONSTRAINT "OutletStockItem_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
