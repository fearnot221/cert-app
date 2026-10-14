-- Serial numbers now come from the import list, so the per-organization sequence is retired.
ALTER TABLE "Organization"
  DROP CONSTRAINT "Organization_certificatePrefix_check",
  DROP CONSTRAINT "Organization_certificateDigits_check",
  DROP CONSTRAINT "Organization_certificateSequence_check",
  DROP COLUMN "certificatePrefix",
  DROP COLUMN "certificateDigits",
  DROP COLUMN "certificateSequence";

-- A reissue keeps its serial, so the same number may appear on several editions of one row,
-- but never on two different rows of the same organization.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DROP INDEX "Certificate_organizationId_number_key";
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_serial_one_lineage"
  EXCLUDE USING gist ("organizationId" WITH =, "number" WITH =, "rowId" WITH <>);
CREATE INDEX "Certificate_organizationId_number_idx" ON "Certificate"("organizationId", "number");
CREATE INDEX "Certificate_number_idx" ON "Certificate"("number");

-- Download passwords: only an argon2id hash is kept, with a per-certificate lockout after repeated failures.
ALTER TABLE "Certificate"
  ADD COLUMN "accessKeyHash" TEXT,
  ADD COLUMN "accessFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessLockedUntil" TIMESTAMP(3);

-- One event can mix templates: each recipient row records its own template version.
ALTER TABLE "BatchRow" ADD COLUMN "templateVersionId" TEXT;
UPDATE "BatchRow" r SET "templateVersionId" = b."templateVersionId"
  FROM "IssuanceBatch" b WHERE b.id = r."batchId";
ALTER TABLE "BatchRow" ALTER COLUMN "templateVersionId" SET NOT NULL;
ALTER TABLE "BatchRow" ADD CONSTRAINT "BatchRow_templateVersionId_organizationId_fkey"
  FOREIGN KEY ("templateVersionId", "organizationId") REFERENCES "TemplateVersion"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recipients were numbered by spreadsheet line, so the first one showed as 2. Renumber from 1.
UPDATE "BatchRow" SET "rowNumber" = -"rowNumber";
UPDATE "BatchRow" r SET "rowNumber" = n.position
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "batchId" ORDER BY -"rowNumber") AS position FROM "BatchRow") n
  WHERE n.id = r.id;
