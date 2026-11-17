-- CreateTable
CREATE TABLE "PayrollAdvanceDismissal" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdvanceDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollAdvanceDismissal_period_id_idx" ON "PayrollAdvanceDismissal"("period_id");
CREATE INDEX "PayrollAdvanceDismissal_employee_id_idx" ON "PayrollAdvanceDismissal"("employee_id");

-- AddForeignKey
ALTER TABLE "PayrollAdvanceDismissal" ADD CONSTRAINT "PayrollAdvanceDismissal_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdvanceDismissal" ADD CONSTRAINT "PayrollAdvanceDismissal_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
