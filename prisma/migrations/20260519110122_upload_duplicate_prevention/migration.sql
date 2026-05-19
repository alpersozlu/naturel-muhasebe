-- AlterTable
ALTER TABLE "PosSlip" ADD COLUMN     "content_fingerprint" TEXT;

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "date_mismatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "duplicate_of_id" TEXT,
ADD COLUMN     "file_hash" TEXT;

-- CreateIndex
CREATE INDEX "PosSlip_daily_record_id_content_fingerprint_idx" ON "PosSlip"("daily_record_id", "content_fingerprint");

-- CreateIndex
CREATE INDEX "Upload_daily_record_id_file_hash_idx" ON "Upload"("daily_record_id", "file_hash");
