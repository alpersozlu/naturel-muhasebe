-- Kartuş payı kuruşun altına iner: 4 hane sakla ki ay toplamı SAP ile kuruşu kuruşuna tutsun.
ALTER TABLE "DealerDailyRep"
  ALTER COLUMN "matrah" SET DATA TYPE DECIMAL(16,4),
  ALTER COLUMN "net_inc_vat" SET DATA TYPE DECIMAL(16,4),
  ALTER COLUMN "kartus" SET DATA TYPE DECIMAL(16,4),
  ALTER COLUMN "net_ciro" SET DATA TYPE DECIMAL(16,4),
  ADD COLUMN "sap_original" BOOLEAN;
