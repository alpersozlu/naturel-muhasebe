-- Bir yükleme birden fazla banka kapanışı taşıyabilir (ortak terminal slibi).
DROP INDEX IF EXISTS "PosSlip_upload_id_key";
CREATE UNIQUE INDEX "PosSlip_upload_id_bank_name_key" ON "PosSlip"("upload_id", "bank_name");
CREATE INDEX "PosSlip_upload_id_idx" ON "PosSlip"("upload_id");
