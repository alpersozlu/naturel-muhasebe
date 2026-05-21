-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "reconciliation_notes" TEXT,
ADD COLUMN     "reconciliation_notes_at" TIMESTAMP(3),
ADD COLUMN     "reconciliation_notes_by" TEXT;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_reconciliation_notes_by_fkey" FOREIGN KEY ("reconciliation_notes_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
