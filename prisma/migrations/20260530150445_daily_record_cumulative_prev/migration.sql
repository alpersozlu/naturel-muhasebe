-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "cumulative_prev_id" TEXT;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_cumulative_prev_id_fkey" FOREIGN KEY ("cumulative_prev_id") REFERENCES "DailyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
