-- CreateTable
CREATE TABLE "NebimActionPrice" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "color_code" TEXT NOT NULL,
    "product_name" TEXT,
    "group_label" TEXT NOT NULL,
    "list_price" DECIMAL(14,2),
    "expected_price" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "batch" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NebimActionPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NebimActionPrice_store_id_item_code_color_code_idx" ON "NebimActionPrice"("store_id", "item_code", "color_code");

-- CreateIndex
CREATE INDEX "NebimActionPrice_effective_from_idx" ON "NebimActionPrice"("effective_from");

-- CreateIndex
CREATE INDEX "NebimActionPrice_batch_idx" ON "NebimActionPrice"("batch");

-- CreateIndex
CREATE UNIQUE INDEX "NebimActionPrice_store_id_item_code_color_code_effective_fr_key" ON "NebimActionPrice"("store_id", "item_code", "color_code", "effective_from");

-- AddForeignKey
ALTER TABLE "NebimActionPrice" ADD CONSTRAINT "NebimActionPrice_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
