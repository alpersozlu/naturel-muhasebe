-- Authenticity screening of uploaded documents (admin-only report).
ALTER TABLE "Upload"
  ADD COLUMN "authenticity_verdict" TEXT,
  ADD COLUMN "authenticity_json" JSONB,
  ADD COLUMN "authenticity_checked_at" TIMESTAMP(3),
  ADD COLUMN "authenticity_cleared_by" TEXT;
CREATE INDEX "Upload_authenticity_verdict_idx" ON "Upload"("authenticity_verdict");
