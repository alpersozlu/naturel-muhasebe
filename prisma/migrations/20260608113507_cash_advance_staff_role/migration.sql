-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('manager', 'assistant_manager', 'sales_staff');

-- AlterTable
ALTER TABLE "CashAdvance" ADD COLUMN     "staff_name" TEXT,
ADD COLUMN     "staff_role" "StaffRole";
