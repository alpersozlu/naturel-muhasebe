-- CreateEnum
CREATE TYPE "HrStatus" AS ENUM ('waiting', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "HrLeaveKind" AS ENUM ('annual', 'lieu', 'sick', 'bereavement', 'unpaid');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'staff';

-- AlterTable
ALTER TABLE "PayrollEmployee" ADD COLUMN     "user_id" TEXT;

-- CreateTable
CREATE TABLE "HrHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrWorkedDay" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "status" "HrStatus" NOT NULL DEFAULT 'waiting',
    "created_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrWorkedDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveRequest" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "HrLeaveKind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "status" "HrStatus" NOT NULL DEFAULT 'waiting',
    "created_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrOvertime" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" "HrStatus" NOT NULL DEFAULT 'waiting',
    "created_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrOvertime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveOpening" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrLeaveOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrProfile" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "national_id" TEXT,
    "birth_date" DATE,
    "nationality" TEXT,
    "gender" TEXT,
    "education_status" TEXT,
    "education_level" TEXT,
    "school" TEXT,
    "disability" TEXT,
    "work_email" TEXT,
    "personal_email" TEXT,
    "work_phone" TEXT,
    "personal_phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "emergency_name" TEXT,
    "emergency_relation" TEXT,
    "emergency_phone" TEXT,
    "contract_type" TEXT,
    "contract_end" DATE,
    "workweek_plan" TEXT,
    "work_permit_no" TEXT,
    "work_permit_expiry" DATE,
    "passport_no" TEXT,
    "passport_expiry" DATE,
    "invited_at" TIMESTAMP(3),
    "invite_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrHoliday_date_key" ON "HrHoliday"("date");

-- CreateIndex
CREATE INDEX "HrWorkedDay_employee_id_date_idx" ON "HrWorkedDay"("employee_id", "date");

-- CreateIndex
CREATE INDEX "HrWorkedDay_status_idx" ON "HrWorkedDay"("status");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_employee_id_start_date_idx" ON "HrLeaveRequest"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_status_idx" ON "HrLeaveRequest"("status");

-- CreateIndex
CREATE INDEX "HrOvertime_employee_id_date_idx" ON "HrOvertime"("employee_id", "date");

-- CreateIndex
CREATE INDEX "HrOvertime_status_idx" ON "HrOvertime"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveOpening_employee_id_year_key" ON "HrLeaveOpening"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "HrProfile_employee_id_key" ON "HrProfile"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEmployee_user_id_key" ON "PayrollEmployee"("user_id");

-- AddForeignKey
ALTER TABLE "PayrollEmployee" ADD CONSTRAINT "PayrollEmployee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrWorkedDay" ADD CONSTRAINT "HrWorkedDay_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOvertime" ADD CONSTRAINT "HrOvertime_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveOpening" ADD CONSTRAINT "HrLeaveOpening_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrProfile" ADD CONSTRAINT "HrProfile_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

