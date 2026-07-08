-- CreateTable
CREATE TABLE "NebimStoreTarget" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "target_try" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NebimStoreTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NebimStoreTarget_store_id_year_month_key" ON "NebimStoreTarget"("store_id", "year", "month");

-- AddForeignKey
ALTER TABLE "NebimStoreTarget" ADD CONSTRAINT "NebimStoreTarget_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
