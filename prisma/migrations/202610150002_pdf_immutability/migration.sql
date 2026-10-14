CREATE OR REPLACE FUNCTION protect_certificate_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
     NEW."templateVersionId" IS DISTINCT FROM OLD."templateVersionId" OR
     NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR
     NEW."dataSnapshot" IS DISTINCT FROM OLD."dataSnapshot" OR
     NEW."number" IS DISTINCT FROM OLD."number" OR
     (OLD."pdfKey" IS NOT NULL AND (
       NEW."pdfKey" IS DISTINCT FROM OLD."pdfKey" OR
       NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256" OR
       NEW."generationStatus" IS DISTINCT FROM 'success')) THEN
    RAISE EXCEPTION 'Certificate snapshots and completed PDFs are immutable';
  END IF;
  RETURN NEW;
END;
$$;
