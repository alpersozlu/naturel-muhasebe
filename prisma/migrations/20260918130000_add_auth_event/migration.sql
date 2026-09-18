-- Sign-in / password event log (support forensics; never stores passwords).
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthEvent_created_at_idx" ON "AuthEvent"("created_at");
CREATE INDEX "AuthEvent_email_created_at_idx" ON "AuthEvent"("email", "created_at");

-- Same lock-down as every other app table: not reachable through PostgREST.
ALTER TABLE "AuthEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AuthEvent" FROM anon, authenticated;
