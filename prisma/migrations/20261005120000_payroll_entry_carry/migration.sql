-- "Sonraki aya devret": bu ayı kapatan kayıt ile sonraki aydaki kesintiyi birbirine bağlar.
ALTER TABLE "PayrollEntry" ADD COLUMN "carry_id" TEXT;
CREATE INDEX "PayrollEntry_carry_id_idx" ON "PayrollEntry"("carry_id");
