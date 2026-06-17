-- CreateTable
CREATE TABLE "NebimSaleLine" (
    "id" TEXT NOT NULL,
    "company_code" INTEGER NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "store_id" TEXT,
    "nebim_store_code" TEXT,
    "store_name_raw" TEXT,
    "invoice_date" DATE NOT NULL,
    "created_date" TIMESTAMP(3),
    "is_return" BOOLEAN NOT NULL DEFAULT false,
    "office" TEXT,
    "item_code" TEXT,
    "item_desc" TEXT,
    "color_code" TEXT,
    "color_desc" TEXT,
    "size" TEXT,
    "salesperson_code" TEXT,
    "salesperson_name" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "price" DECIMAL(14,2),
    "vat_rate" DECIMAL(5,2),
    "amount_vi" DECIMAL(14,2),
    "line_disc" DECIMAL(14,2),
    "doc_disc" DECIMAL(14,2),
    "tax_base" DECIMAL(14,2),
    "vat" DECIMAL(14,2),
    "net_amount" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "source" TEXT NOT NULL DEFAULT 'nebim',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NebimSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NebimSaleLine_store_id_idx" ON "NebimSaleLine"("store_id");

-- CreateIndex
CREATE INDEX "NebimSaleLine_invoice_date_idx" ON "NebimSaleLine"("invoice_date");

-- CreateIndex
CREATE INDEX "NebimSaleLine_store_name_raw_invoice_date_idx" ON "NebimSaleLine"("store_name_raw", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "NebimSaleLine_company_code_invoice_ref_sort_order_key" ON "NebimSaleLine"("company_code", "invoice_ref", "sort_order");

-- AddForeignKey
ALTER TABLE "NebimSaleLine" ADD CONSTRAINT "NebimSaleLine_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
