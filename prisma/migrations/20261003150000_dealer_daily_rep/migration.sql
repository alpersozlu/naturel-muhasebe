-- Günlük bayi gün sonu dosyasından satış temsilcisi bazında ciro (bağımsız prim doğrulaması)
CREATE TABLE "DealerDailyRep" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "rep_code" TEXT NOT NULL,
    "rep_name" TEXT NOT NULL,
    "matrah" DECIMAL(14,2) NOT NULL,
    "net_inc_vat" DECIMAL(14,2) NOT NULL,
    "kartus" DECIMAL(14,2) NOT NULL,
    "net_ciro" DECIMAL(14,2) NOT NULL,
    "units" DECIMAL(12,2) NOT NULL,
    "line_count" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "daily_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerDailyRep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DealerDailyRep_store_id_report_date_idx" ON "DealerDailyRep"("store_id", "report_date");
CREATE UNIQUE INDEX "DealerDailyRep_store_id_report_date_rep_code_key" ON "DealerDailyRep"("store_id", "report_date", "rep_code");
ALTER TABLE "DealerDailyRep" ADD CONSTRAINT "DealerDailyRep_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
