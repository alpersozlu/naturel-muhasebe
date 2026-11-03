-- AlterTable
ALTER TABLE "PayrollEmployee" ADD COLUMN     "paid_by_day" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollLine" ADD COLUMN     "worked_days" DECIMAL(5,2);
