-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "reported_cash_at" TIMESTAMP(3),
ADD COLUMN     "reported_cash_note" TEXT,
ADD COLUMN     "reported_cash_try" DECIMAL(14,2);
