-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "mavi_gift_voucher_at" TIMESTAMP(3),
ADD COLUMN     "mavi_gift_voucher_note" TEXT,
ADD COLUMN     "mavi_gift_voucher_try" DECIMAL(14,2);
