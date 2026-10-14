CREATE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION protect_audit_log();
