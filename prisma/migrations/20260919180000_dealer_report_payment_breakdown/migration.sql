-- SAP dealer report: payment breakdown read from the receipt head rows.
ALTER TABLE "DealerDailyReport"
  ADD COLUMN "cash_try" DECIMAL(14,2),
  ADD COLUMN "card_try" DECIMAL(14,2),
  ADD COLUMN "wire_try" DECIMAL(14,2),
  ADD COLUMN "other_try" DECIMAL(14,2),
  ADD COLUMN "refund_total_try" DECIMAL(14,2);
