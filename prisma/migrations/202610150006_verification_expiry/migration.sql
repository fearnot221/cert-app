ALTER TABLE "IssuanceBatch" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Certificate" ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "Certificate_organizationId_expiresAt_idx" ON "Certificate"("organizationId", "expiresAt");
CREATE FUNCTION protect_certificate_public_id() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
IF NEW."publicId" IS DISTINCT FROM OLD."publicId" THEN RAISE EXCEPTION 'Certificate public ID is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER certificate_public_id_immutable BEFORE UPDATE ON "Certificate" FOR EACH ROW EXECUTE FUNCTION protect_certificate_public_id();
