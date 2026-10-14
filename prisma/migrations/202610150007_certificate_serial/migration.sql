-- Per-organization certificate serial numbers: a configurable prefix plus a zero-padded sequence.
ALTER TABLE "Organization"
  ADD COLUMN "certificatePrefix" TEXT NOT NULL DEFAULT 'CERT',
  ADD COLUMN "certificateDigits" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "certificateSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_certificatePrefix_check" CHECK ("certificatePrefix" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  ADD CONSTRAINT "Organization_certificateDigits_check" CHECK ("certificateDigits" BETWEEN 3 AND 10),
  ADD CONSTRAINT "Organization_certificateSequence_check" CHECK ("certificateSequence" >= 0);

-- Serial numbers repeat across organizations (each starts at 000001), so uniqueness is per organization.
-- Certificates issued before this migration keep their CERT-<uuid> numbers.
DROP INDEX "Certificate_number_key";
CREATE UNIQUE INDEX "Certificate_organizationId_number_key" ON "Certificate"("organizationId", "number");

-- Owners and Admins manage organization settings such as the serial number format.
UPDATE "Role" SET "permissions" = array_append("permissions", 'organization.manage')
WHERE "name" IN ('Owner', 'Admin') AND NOT ('organization.manage' = ANY("permissions"));
