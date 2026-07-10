-- CreateTable
CREATE TABLE "PeopleCountHour" (
    "id" TEXT NOT NULL,
    "store_code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "enter" INTEGER NOT NULL,
    "exit" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'hikvision-kopru',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeopleCountHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeopleCountHour_date_idx" ON "PeopleCountHour"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PeopleCountHour_store_code_date_hour_key" ON "PeopleCountHour"("store_code", "date", "hour");
