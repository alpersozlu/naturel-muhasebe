-- AlterEnum: kurumsal/yönetim alışverişinin bilgi fişi
ALTER TYPE "UploadType" ADD VALUE 'corporate_receipt';

-- AlterTable: alışverişi kendi fişine bağla
ALTER TABLE "CorporatePurchase" ADD COLUMN "upload_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePurchase_upload_id_key" ON "CorporatePurchase"("upload_id");

-- AddForeignKey
ALTER TABLE "CorporatePurchase" ADD CONSTRAINT "CorporatePurchase_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
