-- CreateTable
CREATE TABLE "MeritCard" (
    "id" TEXT NOT NULL,
    "hotel" TEXT NOT NULL DEFAULT 'Merit',
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "source_name" TEXT,
    "photo_date" DATE,
    "full_name" TEXT,
    "name_key" TEXT,
    "id_no" TEXT,
    "company" TEXT,
    "department" TEXT,
    "join_date" TEXT,
    "is_card" BOOLEAN NOT NULL DEFAULT true,
    "ocr_status" TEXT NOT NULL DEFAULT 'pending',
    "ocr_json" JSONB,
    "ocr_error" TEXT,
    "note" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "MeritCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeritInvoiceReview" (
    "id" TEXT NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "card_id" TEXT,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeritInvoiceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeritCard_file_hash_key" ON "MeritCard"("file_hash");

-- CreateIndex
CREATE INDEX "MeritCard_name_key_idx" ON "MeritCard"("name_key");

-- CreateIndex
CREATE INDEX "MeritCard_deleted_at_idx" ON "MeritCard"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "MeritInvoiceReview_invoice_ref_key" ON "MeritInvoiceReview"("invoice_ref");

-- AddForeignKey
ALTER TABLE "MeritInvoiceReview" ADD CONSTRAINT "MeritInvoiceReview_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "MeritCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
