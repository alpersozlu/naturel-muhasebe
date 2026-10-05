-- IT POS per-salesperson table shows some people ABOVE their Net Ciro: on a receipt
-- shared by several salespeople the Kartuş share is taken only from the owner of the
-- first scanned line ("Sıra No" 1). This column keeps, per person and day, the amount
-- IT POS leaves un-deducted — so the month-end IT POS document can be checked exactly.
-- NULL = unknown (export without "Sıra No", or a row written before this column).
ALTER TABLE "DealerDailyRep" ADD COLUMN "itpos_extra" DECIMAL(16,4);
