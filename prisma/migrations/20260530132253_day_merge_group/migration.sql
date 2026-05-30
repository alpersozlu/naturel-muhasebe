-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "merge_group_id" TEXT,
ADD COLUMN     "merge_index" INTEGER;

-- AlterTable
ALTER TABLE "StoreSummary" ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE;

-- CreateTable
CREATE TABLE "DayMergeGroup" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayMergeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DayMergeGroup_store_id_idx" ON "DayMergeGroup"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "DayMergeGroup_store_id_start_date_end_date_key" ON "DayMergeGroup"("store_id", "start_date", "end_date");

-- AddForeignKey
ALTER TABLE "DayMergeGroup" ADD CONSTRAINT "DayMergeGroup_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_merge_group_id_fkey" FOREIGN KEY ("merge_group_id") REFERENCES "DayMergeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
