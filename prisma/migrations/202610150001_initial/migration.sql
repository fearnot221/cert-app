-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "activatedAt" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "isOwner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "assetManifest" JSONB NOT NULL,
    "rendererVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuanceBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'validated',
    "previewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuanceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,

    CONSTRAINT "BatchRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'valid',
    "generationStatus" TEXT NOT NULL DEFAULT 'pending',
    "pdfKey" TEXT,
    "pdfSha256" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mailpit',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConnectionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'development',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SenderIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "senderIdentityId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "messageId" TEXT NOT NULL,
    "error" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorClass" TEXT,
    "smtpCode" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_organizationId_key" ON "Role"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Recipient_userId_idx" ON "Recipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_id_organizationId_key" ON "Recipient"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_organizationId_email_key" ON "Recipient"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Asset_organizationId_createdAt_idx" ON "Asset"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_id_organizationId_key" ON "Asset"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Template_organizationId_createdAt_idx" ON "Template"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Template_id_organizationId_key" ON "Template"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_id_organizationId_key" ON "TemplateVersion"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_number_key" ON "TemplateVersion"("templateId", "number");

-- CreateIndex
CREATE INDEX "IssuanceBatch_organizationId_createdAt_idx" ON "IssuanceBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssuanceBatch_id_organizationId_key" ON "IssuanceBatch"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuanceBatch_organizationId_idempotencyKey_key" ON "IssuanceBatch"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRow_id_organizationId_key" ON "BatchRow"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRow_batchId_rowNumber_key" ON "BatchRow"("batchId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_rowId_key" ON "Certificate"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_number_key" ON "Certificate"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_publicId_key" ON "Certificate"("publicId");

-- CreateIndex
CREATE INDEX "Certificate_organizationId_recipientId_idx" ON "Certificate"("organizationId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_id_organizationId_key" ON "Certificate"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_rowId_organizationId_key" ON "Certificate"("rowId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionGrant_id_organizationId_key" ON "ConnectionGrant"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionGrant_organizationId_connectionId_key" ON "ConnectionGrant"("organizationId", "connectionId");

-- CreateIndex
CREATE INDEX "SenderIdentity_organizationId_idx" ON "SenderIdentity"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SenderIdentity_id_organizationId_key" ON "SenderIdentity"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_userId_consumedAt_idx" ON "Invitation"("userId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_messageId_key" ON "EmailDelivery"("messageId");

-- CreateIndex
CREATE INDEX "EmailDelivery_organizationId_createdAt_idx" ON "EmailDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_id_organizationId_key" ON "EmailDelivery"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_certificateId_senderIdentityId_key" ON "EmailDelivery"("certificateId", "senderIdentityId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_organizationId_deliveryId_idx" ON "DeliveryAttempt"("organizationId", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_completedAt_createdAt_idx" ON "OutboxEvent"("completedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_organizationId_fkey" FOREIGN KEY ("roleId", "organizationId") REFERENCES "Role"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_organizationId_fkey" FOREIGN KEY ("templateId", "organizationId") REFERENCES "Template"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuanceBatch" ADD CONSTRAINT "IssuanceBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuanceBatch" ADD CONSTRAINT "IssuanceBatch_templateVersionId_organizationId_fkey" FOREIGN KEY ("templateVersionId", "organizationId") REFERENCES "TemplateVersion"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRow" ADD CONSTRAINT "BatchRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRow" ADD CONSTRAINT "BatchRow_batchId_organizationId_fkey" FOREIGN KEY ("batchId", "organizationId") REFERENCES "IssuanceBatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_batchId_organizationId_fkey" FOREIGN KEY ("batchId", "organizationId") REFERENCES "IssuanceBatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_rowId_organizationId_fkey" FOREIGN KEY ("rowId", "organizationId") REFERENCES "BatchRow"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_recipientId_organizationId_fkey" FOREIGN KEY ("recipientId", "organizationId") REFERENCES "Recipient"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_templateVersionId_organizationId_fkey" FOREIGN KEY ("templateVersionId", "organizationId") REFERENCES "TemplateVersion"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionGrant" ADD CONSTRAINT "ConnectionGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionGrant" ADD CONSTRAINT "ConnectionGrant_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EmailConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderIdentity" ADD CONSTRAINT "SenderIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderIdentity" ADD CONSTRAINT "SenderIdentity_grantId_organizationId_fkey" FOREIGN KEY ("grantId", "organizationId") REFERENCES "ConnectionGrant"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_certificateId_organizationId_fkey" FOREIGN KEY ("certificateId", "organizationId") REFERENCES "Certificate"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_senderIdentityId_organizationId_fkey" FOREIGN KEY ("senderIdentityId", "organizationId") REFERENCES "SenderIdentity"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_organizationId_fkey" FOREIGN KEY ("deliveryId", "organizationId") REFERENCES "EmailDelivery"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Published versions are immutable even when a future API path accidentally attempts an update.
CREATE FUNCTION protect_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published template versions are immutable'; END;
$$;
CREATE TRIGGER template_version_immutable BEFORE UPDATE OR DELETE ON "TemplateVersion" FOR EACH ROW EXECUTE FUNCTION protect_template_version();

-- Persisted certificate identity and issuance data must never follow mutable recipient/template records.
CREATE FUNCTION protect_certificate_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
     NEW."templateVersionId" IS DISTINCT FROM OLD."templateVersionId" OR
     NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR
     NEW."dataSnapshot" IS DISTINCT FROM OLD."dataSnapshot" OR
     NEW."number" IS DISTINCT FROM OLD."number" OR
     (OLD."generationStatus" = 'success' AND (NEW."pdfKey" IS DISTINCT FROM OLD."pdfKey" OR NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256")) THEN
    RAISE EXCEPTION 'Certificate snapshots and completed PDFs are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER certificate_snapshot_immutable BEFORE UPDATE ON "Certificate" FOR EACH ROW EXECUTE FUNCTION protect_certificate_snapshot();
