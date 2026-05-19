-- DropForeignKey
ALTER TABLE "BankReceipt" DROP CONSTRAINT "BankReceipt_upload_id_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_upload_id_fkey";

-- DropForeignKey
ALTER TABLE "PosSlip" DROP CONSTRAINT "PosSlip_upload_id_fkey";

-- DropForeignKey
ALTER TABLE "StoreSummary" DROP CONSTRAINT "StoreSummary_upload_id_fkey";

-- DropForeignKey
ALTER TABLE "ZReport" DROP CONSTRAINT "ZReport_upload_id_fkey";

-- AddForeignKey
ALTER TABLE "PosSlip" ADD CONSTRAINT "PosSlip_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSummary" ADD CONSTRAINT "StoreSummary_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZReport" ADD CONSTRAINT "ZReport_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
