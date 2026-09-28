-- Nebim trInvoiceHeader.IsCompleted: parked (askıda) POS sales are not completed.
ALTER TABLE "NebimSaleLine" ADD COLUMN "is_completed" BOOLEAN NOT NULL DEFAULT true;
