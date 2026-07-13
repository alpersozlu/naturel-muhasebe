-- CreateTable
CREATE TABLE "PeopleCountRawPush" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeopleCountRawPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeopleCountRawPush_created_at_idx" ON "PeopleCountRawPush"("created_at");
