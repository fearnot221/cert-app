ALTER TABLE "IssuanceBatch" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancelReason" TEXT;
DROP INDEX "Certificate_rowId_key";
DROP INDEX "Certificate_rowId_organizationId_key";
ALTER TABLE "Certificate" ADD COLUMN "edition" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "previousCertificateId" TEXT;
CREATE UNIQUE INDEX "Certificate_rowId_edition_key" ON "Certificate"("rowId","edition");
CREATE UNIQUE INDEX "Certificate_previousCertificateId_key" ON "Certificate"("previousCertificateId");
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_previous_scope_fkey" FOREIGN KEY ("previousCertificateId","organizationId") REFERENCES "Certificate"("id","organizationId");
CREATE FUNCTION protect_certificate_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
IF NEW."rowId" IS DISTINCT FROM OLD."rowId" OR NEW."batchId" IS DISTINCT FROM OLD."batchId" OR NEW.edition IS DISTINCT FROM OLD.edition OR NEW."previousCertificateId" IS DISTINCT FROM OLD."previousCertificateId" THEN RAISE EXCEPTION 'Certificate lineage is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER certificate_lineage_immutable BEFORE UPDATE ON "Certificate" FOR EACH ROW EXECUTE FUNCTION protect_certificate_lineage();
