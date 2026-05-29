-- DropForeignKey
ALTER TABLE "CashAdvance" DROP CONSTRAINT "CashAdvance_employee_id_fkey";

-- AlterTable
ALTER TABLE "CashAdvance" ALTER COLUMN "employee_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
