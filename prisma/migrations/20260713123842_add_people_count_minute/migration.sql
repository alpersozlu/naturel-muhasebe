-- CreateTable
CREATE TABLE "PeopleCountMinute" (
    "id" TEXT NOT NULL,
    "camera_mac" TEXT NOT NULL,
    "store_code" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "enter" INTEGER NOT NULL,
    "exit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeopleCountMinute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeopleCountMinute_store_code_start_idx" ON "PeopleCountMinute"("store_code", "start");

-- CreateIndex
CREATE UNIQUE INDEX "PeopleCountMinute_camera_mac_start_key" ON "PeopleCountMinute"("camera_mac", "start");
