ALTER TABLE "Invitation" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'activation';
CREATE TABLE "AccountMail" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "purpose" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AccountMail_status_createdAt_idx" ON "AccountMail"("status","createdAt");
CREATE INDEX "AccountMail_userId_purpose_createdAt_idx" ON "AccountMail"("userId","purpose","createdAt");
