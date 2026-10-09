-- AlterTable
ALTER TABLE "MeritCard" ADD COLUMN     "store_id" TEXT;

-- CreateIndex
CREATE INDEX "MeritCard_store_id_uploaded_at_idx" ON "MeritCard"("store_id", "uploaded_at");

-- AddForeignKey
ALTER TABLE "MeritCard" ADD CONSTRAINT "MeritCard_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
