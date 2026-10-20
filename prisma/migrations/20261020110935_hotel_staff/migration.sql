-- CreateTable
CREATE TABLE "HotelStaff" (
    "id" TEXT NOT NULL,
    "hotel" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "source_name" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "HotelStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelStaff_hotel_deleted_at_idx" ON "HotelStaff"("hotel", "deleted_at");

-- CreateIndex
CREATE INDEX "HotelStaff_name_key_idx" ON "HotelStaff"("name_key");
