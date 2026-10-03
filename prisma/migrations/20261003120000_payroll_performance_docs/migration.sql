-- Ay sonu performans belgeleri (Mavi) — yükleme, ayrıştırma, çapraz kontrol
CREATE TABLE "PayrollPerformanceDoc" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_path" TEXT,
    "genuine" BOOLEAN,
    "meta_json" JSONB,
    "parsed_json" JSONB NOT NULL,
    "uploaded_by" TEXT,
    "uploaded_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPerformanceDoc_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollPerformanceDoc_period_id_idx" ON "PayrollPerformanceDoc"("period_id");
CREATE UNIQUE INDEX "PayrollPerformanceDoc_period_id_store_id_kind_key" ON "PayrollPerformanceDoc"("period_id", "store_id", "kind");
ALTER TABLE "PayrollPerformanceDoc" ADD CONSTRAINT "PayrollPerformanceDoc_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPerformanceDoc" ADD CONSTRAINT "PayrollPerformanceDoc_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
