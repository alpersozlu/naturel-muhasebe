-- Çalışma izni / şirket borcu: otomatik aylık taksit kesintisi (sahibi, 02.10.2026)
ALTER TABLE "PayrollLoan" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'loan';
ALTER TABLE "PayrollLoan" ADD COLUMN "installment" DECIMAL(14,2);
ALTER TABLE "PayrollLoan" ADD COLUMN "auto_deduct" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PayrollLoan" ADD COLUMN "start_year" INTEGER;
ALTER TABLE "PayrollLoan" ADD COLUMN "start_month" INTEGER;
