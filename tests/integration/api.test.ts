import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { config } from "@cert/config";
import { db, rolePermissions, storage } from "@cert/domain";
import {
  closeJobResources,
  processMail,
  processPdf,
} from "../../packages/domain/src/jobs";
import {
  createDefaultDocument,
  FONT_ASSET_VERSION,
  FONT_SHA256,
  type TemplateDocument,
} from "@cert/contracts";
import { buildApp } from "../../apps/api/src/server";
import { hashToken } from "../../apps/api/src/auth";

const prefix = `integration-${randomUUID()}`;
const password = "Integration-Only-2026!";
const orgA = randomUUID();
const orgB = randomUUID();
const connectionId = randomUUID();
const senderA = randomUUID();
const senderB = randomUUID();
const assetB = randomUUID();
const email = (name: string) => `${prefix}-${name}@example.test`;
/** Imported serials are unique per organization, so every run uses its own. */
const runSerial = randomUUID().slice(0, 8).toUpperCase();
const sn = (name: string) => `T${runSerial}-${name}`.toUpperCase();
const json = (value: unknown) => value as Prisma.InputJsonValue;
let app: FastifyInstance;
let owner: Client;
let designer: Client;
let recipient: Client;
let ownerId: string;
let recipientId: string;
let otherRecipientId: string;
let templateA: string;
let templateB: string;
let versionA: string;
let versionB: string;
let certA: string;
let certB: string;
let batchA: string;
let batchB: string;
let document: TemplateDocument;
let originalPasswordHash: string;
let fixtureStarted = false;
let lastServerError: Error | undefined;
const mailpitOrigin =
  process.env.MAILPIT_HTTP_ORIGIN ?? "http://127.0.0.1:58025";

async function receivedMail(address: string): Promise<{
  Text: string;
  HTML: string;
  To: { Address: string }[];
  From: { Address: string };
  MessageID: string;
}> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `${mailpitOrigin}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { messages: { ID: string }[] };
    if (result.messages.length) {
      const message = await fetch(
        `${mailpitOrigin}/api/v1/message/${result.messages[0]!.ID}`,
      );
      expect(message.status).toBe(200);
      return message.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mailpit did not receive the test message");
}

/** Real cookie/session/CSRF requests. There are no authentication mocks. */
let clientNumber = 1;
class Client {
  private remoteAddress = `127.0.0.${clientNumber++}`;
  constructor(remoteAddress?: string) {
    if (remoteAddress) this.remoteAddress = remoteAddress;
  }
  private cookies = new Map<string, string>();
  private token = "";
  async csrf() {
    const response = await app.inject({ method: "GET", url: "/api/auth/csrf" });
    this.capture(response.cookies);
    this.token = response.json().csrfToken;
  }
  private capture(cookies: { name: string; value: string }[]) {
    for (const cookie of cookies) this.cookies.set(cookie.name, cookie.value);
  }
  async request(
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: Record<string, unknown>,
    options: { csrf?: boolean; origin?: string } = {},
  ) {
    const response = await app.inject({
      method,
      url,
      payload,
      remoteAddress: this.remoteAddress,
      headers: {
        cookie: [...this.cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...(options.csrf === false ? {} : { "x-csrf-token": this.token }),
        ...(options.origin ? { origin: options.origin } : {}),
      },
    });
    this.capture(response.cookies);
    return response;
  }
  async upload(url: string, filename: string, bytes: Buffer) {
    const boundary = `upload-${randomUUID()}`;
    return app.inject({
      method: "POST",
      url,
      remoteAddress: this.remoteAddress,
      headers: {
        cookie: [...this.cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        "x-csrf-token": this.token,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }
  async login(address: string) {
    await this.csrf();
    const response = await this.request("POST", "/api/auth/login", {
      email: address,
      password,
    });
    expect(response.statusCode, response.body).toBe(200);
  }
}

async function createPublishedTemplate(organizationId: string, name = "整合測試模板", source: TemplateDocument = document) {
  const template = await db.template.create({
    data: { organizationId, name, document: json(source) },
  });
  const version = await db.templateVersion.create({
    data: {
      organizationId,
      templateId: template.id,
      number: 1,
      document: json(source),
      rendererVersion: "1",
      assetManifest: {
        font: { version: FONT_ASSET_VERSION, sha256: FONT_SHA256 },
        background: null,
      },
    },
  });
  return { template, version };
}

async function createCertificate(
  organizationId: string,
  templateVersionId: string,
  userId: string,
  suffix: string,
  pending = false,
) {
  const person = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const addressee = await db.recipient.upsert({
    where: { organizationId_email: { organizationId, email: person.email } },
    create: {
      organizationId,
      userId,
      email: person.email,
      name: `收件人${suffix}`,
    },
    update: {},
  });
  const batch = await db.issuanceBatch.create({
    data: {
      organizationId,
      templateVersionId,
      eventName: `測試課程${suffix}`,
      idempotencyKey: randomUUID(),
      status: pending ? "generating" : "generated",
      previewedAt: new Date(),
    },
  });
  const id = randomUUID();
  const rowData = {
    recipient_name: addressee.name,
    recipient_email: person.email,
    certificate_number: `TEST-${id}`,
  };
  const row = await db.batchRow.create({
    data: {
      organizationId,
      batchId: batch.id,
      rowNumber: 1,
      templateVersionId,
      data: rowData,
      status: pending ? "pending" : "success",
    },
  });
  const pdfKey = `${organizationId}/certificates/${id}.pdf`;
  await storage.put(pdfKey, Buffer.from(`%PDF-1.4\nprivate-fixture-${suffix}`));
  const cert = await db.certificate.create({
    data: {
      id,
      organizationId,
      batchId: batch.id,
      rowId: row.id,
      recipientId: addressee.id,
      templateVersionId,
      number: `TEST-${id}`,
      dataSnapshot: {
        ...rowData,
        organization_name: suffix,
        event_name: batch.eventName,
        issue_date: "2026-10-15",
        certificate_number: `TEST-${id}`,
      },
      generationStatus: pending ? "pending" : "success",
      pdfKey: pending ? null : pdfKey,
      pdfSha256: pending ? null : "fixture-only",
    },
  });
  return { cert, batch };
}

beforeAll(async () => {
  if (
    config.NODE_ENV !== "test" ||
    !new URL(config.DATABASE_URL).pathname.endsWith("_test")
  ) {
    throw new Error(
      "Integration tests require NODE_ENV=test and a separate DATABASE_URL ending in _test",
    );
  }
  fixtureStarted = true;
  document = createDefaultDocument();
  originalPasswordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });
  await db.organization.createMany({
    data: [
      { id: orgA, name: `${prefix} A` },
      { id: orgB, name: `${prefix} B` },
    ],
  });
  const ownerUser = await db.user.create({
    data: {
      email: email("owner"),
      passwordHash: originalPasswordHash,
      activatedAt: new Date(),
    },
  });
  const designerUser = await db.user.create({
    data: {
      email: email("designer"),
      passwordHash: originalPasswordHash,
      activatedAt: new Date(),
    },
  });
  const recipientUser = await db.user.create({
    data: {
      email: email("recipient"),
      passwordHash: originalPasswordHash,
      activatedAt: new Date(),
    },
  });
  const otherRecipient = await db.user.create({
    data: {
      email: email("other-recipient"),
      passwordHash: originalPasswordHash,
      activatedAt: new Date(),
    },
  });
  ownerId = ownerUser.id;
  recipientId = recipientUser.id;
  otherRecipientId = otherRecipient.id;
  const role = await db.role.create({
    data: {
      organizationId: orgA,
      name: "Owner",
      permissions: rolePermissions.Owner!,
      isOwner: true,
    },
  });
  const designerRole = await db.role.create({
    data: {
      organizationId: orgA,
      name: "Designer",
      permissions: rolePermissions.Designer!,
    },
  });
  await db.membership.createMany({
    data: [
      { organizationId: orgA, userId: ownerUser.id, roleId: role.id },
      {
        organizationId: orgA,
        userId: designerUser.id,
        roleId: designerRole.id,
      },
    ],
  });
  await db.emailConnection.create({
    data: { id: connectionId, name: prefix, provider: "mailpit" },
  });
  for (const [organizationId, senderId, suffix] of [
    [orgA, senderA, "a"],
    [orgB, senderB, "b"],
  ] as const) {
    const grant = await db.connectionGrant.create({
      data: { organizationId, connectionId },
    });
    await db.senderIdentity.create({
      data: {
        id: senderId,
        organizationId,
        grantId: grant.id,
        displayName: `測試單位 ${suffix}`,
        fromAddress: `${suffix}@example.test`,
        status: "development",
      },
    });
  }
  await db.asset.create({
    data: {
      id: assetB,
      organizationId: orgB,
      filename: "foreign.png",
      mimeType: "image/png",
      storageKey: `${orgB}/assets/${assetB}.png`,
      sha256: "fixture",
      width: 1,
      height: 1,
      size: 1,
    },
  });
  const a = await createPublishedTemplate(orgA);
  const b = await createPublishedTemplate(orgB);
  templateA = a.template.id;
  versionA = a.version.id;
  templateB = b.template.id;
  versionB = b.version.id;
  const aCert = await createCertificate(orgA, versionA, recipientId, "A");
  const bCert = await createCertificate(orgB, versionB, otherRecipientId, "B");
  certA = aCert.cert.id;
  batchA = aCert.batch.id;
  certB = bCert.cert.id;
  batchB = bCert.batch.id;
  app = await buildApp();
  app.addHook("onError", async (_request, _reply, error) => {
    lastServerError = error;
  });
  await app.ready();
  owner = new Client();
  designer = new Client();
  recipient = new Client();
  await owner.login(ownerUser.email);
  await designer.login(designerUser.email);
  await recipient.login(recipientUser.email);
});

afterAll(async () => {
  if (!fixtureStarted) {
    await db.$disconnect();
    return;
  }
  if (app) await app.close();
  const where = { organizationId: { in: [orgA, orgB] } };
  // Only this run's UUID fixtures are removed. No truncation or seed resets.
  await db.deliveryAttempt.deleteMany({ where });
  await db.emailDelivery.deleteMany({ where });
  await db.outboxEvent.deleteMany({ where });
  await db.certificate.deleteMany({ where });
  await db.batchRow.deleteMany({ where });
  await db.issuanceBatch.deleteMany({ where });
  await db.$transaction(async (tx) => {
    // Test database only. The table lock and transaction prevent any other session observing disabled protection.
    await tx.$executeRawUnsafe(
      'ALTER TABLE "TemplateVersion" DISABLE TRIGGER template_version_immutable',
    );
    await tx.templateVersion.deleteMany({ where });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "TemplateVersion" ENABLE TRIGGER template_version_immutable',
    );
  });
  await db.template.deleteMany({ where });
  await db.asset.deleteMany({ where });
  await db.recipient.deleteMany({ where });
  await db.senderIdentity.deleteMany({ where });
  await db.connectionGrant.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_append_only');
    await tx.auditLog.deleteMany({ where });
    await tx.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_append_only');
  });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.emailConnection.deleteMany({ where: { id: connectionId } });
  await db.invitation.deleteMany({
    where: { user: { email: { startsWith: prefix } } },
  });
  await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await Promise.all(
    [orgA, orgB].map((id) =>
      rm(resolve(config.STORAGE_ROOT, id), { recursive: true, force: true }),
    ),
  );
  await closeJobResources();
  await db.$disconnect();
});

describe("tenant boundaries and permission enforcement", () => {
  it("requires a server session and CSRF token, including login", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/organizations/${orgA}/templates`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: email("owner"), password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/templates`,
          { name: "CSRF", document },
          { csrf: false },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/templates`,
          { name: "CSRF", document },
          { origin: "https://attacker.invalid" },
        )
      ).statusCode,
    ).toBe(403);
  });

  it("cannot change organization scope to read, edit, download or send another organization data", async () => {
    for (const path of [
      "templates",
      `batches/${batchB}`,
      `certificates/${certB}/pdf`,
      `assets/${assetB}/file`,
      "senders",
      "audit",
    ]) {
      const response = await owner.request(
        "GET",
        `/api/organizations/${orgB}/${path}`,
      );
      expect(response.statusCode, `${path}: ${response.body}`).toBe(403);
    }
    expect(
      (
        await owner.request(
          "PUT",
          `/api/organizations/${orgB}/templates/${templateB}`,
          { name: "越權修改", document, revision: 1 },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgB}/batches/${batchB}/send`,
          { senderIdentityId: senderB },
        )
      ).statusCode,
    ).toBe(403);
  });

  it("cannot reference foreign resource IDs through an authorized organization route", async () => {
    expect(
      (
        await owner.request(
          "GET",
          `/api/organizations/${orgA}/templates/${templateB}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await owner.request(
          "GET",
          `/api/organizations/${orgB}/templates/${templateB}`,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "GET",
          `/api/organizations/${orgA}/batches/${batchB}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await owner.request(
          "GET",
          `/api/organizations/${orgA}/certificates/${certB}/pdf`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await owner.request(
          "GET",
          `/api/organizations/${orgA}/assets/${assetB}/file`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await owner.request(
          "PUT",
          `/api/organizations/${orgA}/templates/${templateB}`,
          { name: "越權", document, revision: 1 },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await owner.request("POST", `/api/organizations/${orgA}/templates`, {
          name: "越權素材",
          document: { ...document, backgroundAssetId: assetB },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/validate`,
          {
            templateVersionId: versionB,
            eventName: "越權",
            csv: `recipient_name,recipient_email,certificate_number\n測試,${email("new")},${sn("scope")}`,
          },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await db.template.findUniqueOrThrow({ where: { id: templateB } })).name,
    ).toBe("整合測試模板");
  });

  it("enforces designer restrictions on direct API calls", async () => {
    expect(
      (await designer.request("GET", `/api/organizations/${orgA}/templates`))
        .statusCode,
    ).toBe(200);
    for (const action of ["generate", "retry", "send"]) {
      const response = await designer.request(
        "POST",
        `/api/organizations/${orgA}/batches/${batchA}/${action}`,
        { senderIdentityId: senderA },
      );
      expect(response.statusCode, response.body).toBe(403);
    }
    expect(
      (
        await designer.request(
          "GET",
          `/api/organizations/${orgA}/certificates/${certA}/pdf`,
        )
      ).statusCode,
    ).toBe(403);
  });

  it("gives recipients only their own PDFs and no implicit staff membership", async () => {
    const list = await recipient.request("GET", "/api/me/certificates");
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toEqual([
      certA,
    ]);
    const own = await recipient.request(
      "GET",
      `/api/me/certificates/${certA}/pdf`,
    );
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain("private-fixture-A");
    expect(
      (await recipient.request("GET", `/api/me/certificates/${certB}/pdf`))
        .statusCode,
    ).toBe(404);
    expect(
      (await recipient.request("GET", `/api/organizations/${orgA}/templates`))
        .statusCode,
    ).toBe(403);
    expect(
      (await recipient.request("GET", "/api/auth/me")).json().memberships,
    ).toEqual([]);
  });

  it("rejects cross-tenant relations at the database boundary", async () => {
    await expect(
      db.issuanceBatch.create({
        data: {
          organizationId: orgA,
          templateVersionId: versionB,
          eventName: "非法關聯",
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.emailDelivery.create({
        data: {
          organizationId: orgA,
          certificateId: certA,
          senderIdentityId: senderB,
          toAddress: email("recipient"),
          messageId: `<${randomUUID()}@example.test>`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("revokes active sessions ability to operate when the organization is disabled", async () => {
    await db.organization.update({
      where: { id: orgA },
      data: { active: false },
    });
    try {
      expect(
        (await owner.request("GET", `/api/organizations/${orgA}/templates`))
          .statusCode,
      ).toBe(403);
      expect(
        (await recipient.request("GET", `/api/me/certificates/${certA}/pdf`))
          .statusCode,
      ).toBe(404);
    } finally {
      await db.organization.update({
        where: { id: orgA },
        data: { active: true },
      });
    }
  });
});

describe("immutable publication and idempotent issuance", () => {
  it("rejects stale edits and leaves published versions and issued certificate snapshots unchanged", async () => {
    const before = await db.templateVersion.findUniqueOrThrow({
      where: { id: versionA },
    });
    const certBefore = await db.certificate.findUniqueOrThrow({
      where: { id: certA },
    });
    const updated = structuredClone(document);
    updated.elements.find((element) => element.id === "title")!.text =
      "新的證書標題";
    const save = await owner.request(
      "PUT",
      `/api/organizations/${orgA}/templates/${templateA}`,
      { name: "修改草稿", document: updated, revision: 1 },
    );
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().revision).toBe(2);
    expect(
      (
        await owner.request(
          "PUT",
          `/api/organizations/${orgA}/templates/${templateA}`,
          { name: "過期內容", document, revision: 1 },
        )
      ).statusCode,
    ).toBe(409);
    const publish = await owner.request(
      "POST",
      `/api/organizations/${orgA}/templates/${templateA}/publish`,
    );
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json().number).toBe(2);
    const repeated = await owner.request(
      "POST",
      `/api/organizations/${orgA}/templates/${templateA}/publish`,
    );
    expect(repeated.json().id).toBe(publish.json().id);
    expect(
      (await db.templateVersion.findUniqueOrThrow({ where: { id: versionA } }))
        .document,
    ).toEqual(before.document);
    const certAfter = await db.certificate.findUniqueOrThrow({
      where: { id: certA },
    });
    expect(certAfter.dataSnapshot).toEqual(certBefore.dataSnapshot);
    expect(certAfter.templateVersionId).toBe(versionA);
    expect(certAfter.pdfKey).toBe(certBefore.pdfKey);
    await expect(
      db.templateVersion.update({
        where: { id: versionA },
        data: { document: json(updated) },
      }),
    ).rejects.toThrow();
    await expect(
      db.certificate.update({
        where: { id: certA },
        data: { pdfSha256: "replacement-hash" },
      }),
    ).rejects.toThrow();
    // A status rollback must not provide a route around completed-PDF immutability.
    await expect(
      db.certificate.update({
        where: { id: certA },
        data: { generationStatus: "failed" },
      }),
    ).rejects.toThrow();
    expect(
      (await db.certificate.findUniqueOrThrow({ where: { id: certA } }))
        .generationStatus,
    ).toBe("success");
  });

  it("requires server preview, then duplicate generation creates one certificate and one durable outbox event per row", async () => {
    const body = {
      templateVersionId: versionA,
      eventName: "既有帳號再發證",
      csv: `recipient_name,recipient_email,certificate_number\n既有使用者,${email("owner")},${sn("dup-1")}\n新收件人,${email("new")},${sn("dup-2")}`,
      idempotencyKey: randomUUID(),
    };
    const created = await owner.request(
      "POST",
      `/api/organizations/${orgA}/batches`,
      body,
    );
    expect(
      created.statusCode,
      `${created.body}\n${lastServerError?.message ?? ""}`,
    ).toBe(200);
    const batchId = created.json().id;
    const repeated = await owner.request(
      "POST",
      `/api/organizations/${orgA}/batches`,
      body,
    );
    expect(repeated.json().id).toBe(batchId);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/${batchId}/generate`,
        )
      ).statusCode,
    ).toBe(409);
    const row = await db.batchRow.findFirstOrThrow({ where: { batchId } });
    const preview = await owner.request(
      "POST",
      `/api/organizations/${orgA}/batches/${batchId}/preview`,
      { rowId: row.id },
    );
    expect(
      preview.statusCode,
      preview.headers["content-type"] === "application/pdf" ? "" : preview.body,
    ).toBe(200);
    expect(preview.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const responses = await Promise.all([
      owner.request(
        "POST",
        `/api/organizations/${orgA}/batches/${batchId}/generate`,
      ),
      owner.request(
        "POST",
        `/api/organizations/${orgA}/batches/${batchId}/generate`,
      ),
    ]);
    for (const response of responses)
      expect(
        response.statusCode,
        `${response.body} ${lastServerError?.stack ?? ""}`,
      ).toBe(200);
    const certificates = await db.certificate.findMany({ where: { batchId } });
    expect(certificates).toHaveLength(2);
    expect(
      await db.outboxEvent.count({
        where: {
          organizationId: orgA,
          kind: "pdf",
          entityId: { in: certificates.map((cert) => cert.id) },
        },
      }),
    ).toBe(2);
    expect(
      await db.emailDelivery.count({
        where: { certificateId: { in: certificates.map((cert) => cert.id) } },
      }),
    ).toBe(0);
    const existingUser = await db.user.findUniqueOrThrow({
      where: { id: ownerId },
    });
    expect(existingUser.passwordHash).toBe(originalPasswordHash);
    expect(existingUser.activatedAt).not.toBeNull();
    expect(
      await db.membership.count({ where: { user: { email: email("new") } } }),
    ).toBe(0);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/${batchId}/send`,
          { senderIdentityId: senderA },
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe("sender authorization and separate notification requests", () => {
  it("blocks foreign/disabled sender identities and arbitrary From overrides", async () => {
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/${batchA}/send`,
          { senderIdentityId: senderB },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/${batchA}/send`,
          { senderIdentityId: senderA, from: "admin@another.example" },
        )
      ).statusCode,
    ).toBe(400);
    await db.senderIdentity.update({
      where: { id: senderA },
      data: { active: false },
    });
    try {
      expect(
        (
          await owner.request(
            "POST",
            `/api/organizations/${orgA}/batches/${batchA}/send`,
            { senderIdentityId: senderA },
          )
        ).statusCode,
      ).toBe(403);
    } finally {
      await db.senderIdentity.update({
        where: { id: senderA },
        data: { active: true },
      });
    }
    expect(
      await db.emailDelivery.count({ where: { certificateId: certA } }),
    ).toBe(0);
  });

  it("queues only one notification and leaves delivery state queued until the worker runs", async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await owner.request(
        "POST",
        `/api/organizations/${orgA}/batches/${batchA}/send`,
        { senderIdentityId: senderA },
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().queued).toBe(i === 0 ? 1 : 0);
      if (i === 1) expect(response.json().skipped.inProgress).toBe(1);
    }
    const deliveries = await db.emailDelivery.findMany({
      where: { certificateId: certA },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("queued");
    expect(deliveries[0]!.acceptedAt).toBeNull();
    expect(
      await db.outboxEvent.count({
        where: { kind: "mail", entityId: deliveries[0]!.id },
      }),
    ).toBe(1);
  });
});

describe("worker authorization, recovery, and durable state", () => {
  it("rejects a worker job whose organization does not own the certificate", async () => {
    await expect(processPdf(certB, orgA)).rejects.toThrow("scope mismatch");
    expect(
      (await db.certificate.findUniqueOrThrow({ where: { id: certB } }))
        .generationStatus,
    ).toBe("success");
  });

  it("survives duplicate concurrent PDF executions without rewriting the completed artifact", async () => {
    const fixture = await createCertificate(
      orgA,
      versionA,
      recipientId,
      "重複工作",
      true,
    );
    await Promise.all([
      processPdf(fixture.cert.id, orgA),
      processPdf(fixture.cert.id, orgA),
    ]);
    const completed = await db.certificate.findUniqueOrThrow({
      where: { id: fixture.cert.id },
    });
    expect(completed.generationStatus).toBe("success");
    expect(completed.pdfKey).not.toBeNull();
    const bytes = await storage.get(completed.pdfKey!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      completed.pdfSha256,
    );
    await processPdf(fixture.cert.id, orgA);
    expect(await storage.get(completed.pdfKey!)).toEqual(bytes);
    expect(
      (
        await db.certificate.findUniqueOrThrow({
          where: { id: fixture.cert.id },
        })
      ).pdfSha256,
    ).toBe(completed.pdfSha256);
    expect(
      (
        await db.issuanceBatch.findUniqueOrThrow({
          where: { id: fixture.batch.id },
        })
      ).status,
    ).toBe("generated");
  });

  it("reconciles batch completion when a worker restarts after PDF success committed", async () => {
    const fixture = await createCertificate(
      orgA,
      versionA,
      recipientId,
      "成功提交後中斷",
    );
    // Simulate a crash between the certificate/row transaction and finishBatch.
    await db.issuanceBatch.update({
      where: { id: fixture.batch.id },
      data: { status: "generating" },
    });
    await processPdf(fixture.cert.id, orgA);
    expect(
      (
        await db.issuanceBatch.findUniqueOrThrow({
          where: { id: fixture.batch.id },
        })
      ).status,
    ).toBe("generated");
    expect(
      (
        await db.certificate.findUniqueOrThrow({
          where: { id: fixture.cert.id },
        })
      ).pdfKey,
    ).toBe(fixture.cert.pdfKey);
  });

  it("refuses a background whose current asset hash diverges from the published version manifest", async () => {
    const original = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const replacement = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#000000" },
    })
      .png()
      .toBuffer();
    const assetId = randomUUID();
    const storageKey = `${orgA}/assets/${assetId}.png`;
    const originalHash = createHash("sha256").update(original).digest("hex");
    await storage.put(storageKey, original);
    await db.asset.create({
      data: {
        id: assetId,
        organizationId: orgA,
        filename: "snapshot.png",
        mimeType: "image/png",
        storageKey,
        sha256: originalHash,
        width: 20,
        height: 20,
        size: original.length,
      },
    });
    const snapshot = { ...document, backgroundAssetId: assetId };
    const template = await db.template.create({
      data: {
        organizationId: orgA,
        name: "背景版本測試",
        document: json(snapshot),
      },
    });
    const version = await db.templateVersion.create({
      data: {
        organizationId: orgA,
        templateId: template.id,
        number: 1,
        document: json(snapshot),
        rendererVersion: "1",
        assetManifest: {
          font: { version: FONT_ASSET_VERSION, sha256: FONT_SHA256 },
          background: { id: assetId, sha256: originalHash },
        },
      },
    });
    const fixture = await createCertificate(
      orgA,
      version.id,
      recipientId,
      "資產版本不符",
      true,
    );
    // Simulate an asset restore/update that changed both metadata and bytes after publication.
    await storage.put(storageKey, replacement);
    await db.asset.update({
      where: { id: assetId },
      data: {
        sha256: createHash("sha256").update(replacement).digest("hex"),
        size: replacement.length,
      },
    });
    await processPdf(fixture.cert.id, orgA);
    expect(
      (
        await db.certificate.findUniqueOrThrow({
          where: { id: fixture.cert.id },
        })
      ).generationStatus,
    ).toBe("failed");
    expect(
      (
        await db.batchRow.findUniqueOrThrow({
          where: { id: fixture.cert.rowId },
        })
      ).error,
    ).toBeTruthy();
  });

  it("rechecks sender and organization authorization at execution time", async () => {
    for (const revoke of ["sender", "organization"] as const) {
      const fixture = await createCertificate(
        orgA,
        versionA,
        recipientId,
        `撤銷${revoke}`,
      );
      const delivery = await db.emailDelivery.create({
        data: {
          organizationId: orgA,
          certificateId: fixture.cert.id,
          senderIdentityId: senderA,
          toAddress: email("recipient"),
          messageId: `<${randomUUID()}@example.test>`,
        },
      });
      if (revoke === "sender")
        await db.senderIdentity.update({
          where: { id: senderA },
          data: { active: false },
        });
      else
        await db.organization.update({
          where: { id: orgA },
          data: { active: false },
        });
      try {
        await processMail(delivery.id, orgA);
        expect(
          (
            await db.emailDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).status,
        ).toBe("failed");
        expect(
          await db.deliveryAttempt.count({
            where: { deliveryId: delivery.id },
          }),
        ).toBe(0);
      } finally {
        await db.senderIdentity.update({
          where: { id: senderA },
          data: { active: true },
        });
        await db.organization.update({
          where: { id: orgA },
          data: { active: true },
        });
      }
    }
  });

  it("marks interrupted SMTP attempts unknown and does not blindly resend", async () => {
    const fixture = await createCertificate(
      orgA,
      versionA,
      recipientId,
      "寄送中斷",
    );
    const delivery = await db.emailDelivery.create({
      data: {
        organizationId: orgA,
        certificateId: fixture.cert.id,
        senderIdentityId: senderA,
        toAddress: email("recipient"),
        messageId: `<${randomUUID()}@example.test>`,
        status: "sending",
      },
    });
    await db.deliveryAttempt.create({
      data: {
        organizationId: orgA,
        deliveryId: delivery.id,
        status: "sending",
      },
    });
    await processMail(delivery.id, orgA);
    await processMail(delivery.id, orgA);
    const result = await db.emailDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { attempts: true },
    });
    expect(result.status).toBe("unknown");
    expect(result.acceptedAt).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.status).toBe("unknown");
    expect(result.attempts[0]!.errorClass).toBe("interrupted");
  });
});

describe("account activation is atomic, expiring, and password preserving", () => {
  it("does not consume on GET, rejects expired tokens, and allows exactly one concurrent activation", async () => {
    const user = await db.user.create({ data: { email: email("activation") } });
    const expired = randomBytes(32).toString("base64url");
    const token = randomBytes(32).toString("base64url");
    const otherToken = randomBytes(32).toString("base64url");
    await db.invitation.createMany({
      data: [
        {
          userId: user.id,
          tokenHash: hashToken(expired),
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60000),
        },
        {
          userId: user.id,
          tokenHash: hashToken(otherToken),
          expiresAt: new Date(Date.now() + 60000),
        },
      ],
    });
    const activation = new Client();
    await activation.csrf();
    expect(
      (await activation.request("GET", `/api/auth/activate?token=${token}`))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await db.invitation.findUniqueOrThrow({
          where: { tokenHash: hashToken(token) },
        })
      ).consumedAt,
    ).toBeNull();
    expect(
      (
        await activation.request("POST", "/api/auth/activate", {
          token: expired,
          password,
        })
      ).statusCode,
    ).toBe(400);
    const oldSession = randomBytes(32).toString("base64url");
    await db.session.create({
      data: {
        tokenHash: hashToken(oldSession),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const results = await Promise.all([
      activation.request("POST", "/api/auth/activate", { token, password }),
      activation.request("POST", "/api/auth/activate", { token, password }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 400,
    ]);
    expect(
      (
        await activation.request("POST", "/api/auth/activate", {
          token,
          password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await activation.request("POST", "/api/auth/activate", {
          token: otherToken,
          password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      await db.session.findUnique({
        where: { tokenHash: hashToken(oldSession) },
      }),
    ).toBeNull();
    const activated = await db.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(activated.activatedAt).not.toBeNull();
    expect(await argon2.verify(activated.passwordHash!, password)).toBe(true);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);
  });

  it("cannot reset an already activated account through an invitation", async () => {
    const token = randomBytes(32).toString("base64url");
    await db.invitation.create({
      data: {
        userId: ownerId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const response = await owner.request("POST", "/api/auth/activate", {
      token,
      password: "Attacker-Replacement-2026!",
    });
    expect(response.statusCode).toBe(400);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: ownerId } }))
        .passwordHash,
    ).toBe(originalPasswordHash);
  });
});

describe("real Mailpit notification content", () => {
  it("mails the serial with a fresh password, stores only its hash, and the pair downloads the PDF without an account", async () => {
    const user = await db.user.create({ data: { email: email("mail-password") } });
    const fixture = await createCertificate(orgA, versionA, user.id, "Mailpit密碼");
    const delivery = await db.emailDelivery.create({
      data: {
        organizationId: orgA,
        certificateId: fixture.cert.id,
        senderIdentityId: senderA,
        toAddress: user.email,
        messageId: `<${randomUUID()}@example.test>`,
      },
    });
    await Promise.all([processMail(delivery.id, orgA), processMail(delivery.id, orgA)]);
    const result = await db.emailDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { attempts: true },
    });
    expect(result.status).toBe("accepted");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.smtpCode).toBe(250);
    const mail = await receivedMail(user.email);
    expect(mail.To.map((recipient) => recipient.Address)).toEqual([user.email]);
    expect(mail.Text).toContain(fixture.cert.number);
    expect(mail.Text).toContain(`/download?serial=${encodeURIComponent(fixture.cert.number)}`);
    expect(mail.Text).not.toContain("/activate#");
    expect(mail.HTML).toContain("href=");
    const mailed = /下載密碼：([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(mail.Text)?.[1];
    expect(mailed).toBeTruthy();
    const stored = await db.certificate.findUniqueOrThrow({ where: { id: fixture.cert.id } });
    expect(stored.accessKeyHash).toMatch(/^\$argon2id\$/);
    expect(stored.accessKeyHash).not.toContain(mailed!.replaceAll("-", ""));
    expect(await db.invitation.count({ where: { userId: user.id } })).toBe(0);

    const visitor = new Client("10.20.0.1");
    await visitor.csrf();
    const download = (password: string, serial = fixture.cert.number.toLowerCase()) =>
      visitor.request("POST", "/api/public/certificates/download", { serial, password });
    const ok = await download(mailed!.replaceAll("-", "").toLowerCase());
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers["content-type"]).toContain("application/pdf");
    expect(ok.rawPayload).toEqual(await storage.get(stored.pdfKey!));
    expect(await db.auditLog.count({ where: { resourceId: fixture.cert.id, action: "certificate.downloaded_with_password" } })).toBe(1);
    expect((await download("AAAA-BBBB-CCCC")).statusCode).toBe(403);
    expect((await download(mailed!, "NO-SUCH-SERIAL")).statusCode).toBe(403);

    await db.certificate.update({ where: { id: fixture.cert.id }, data: { status: "revoked" } });
    expect((await download(mailed!)).statusCode).toBe(410);
    await db.certificate.update({ where: { id: fixture.cert.id }, data: { status: "valid", accessFailures: 0 } });
  });

  it("locks a serial after repeated wrong passwords, rotates the password on a new notification, and looks serials up without personal data", async () => {
    const user = await db.user.create({ data: { email: email("mail-rotate") } });
    const fixture = await createCertificate(orgA, versionA, user.id, "Mailpit換密碼");
    const grant = await db.connectionGrant.findFirstOrThrow({ where: { organizationId: orgA, connectionId } });
    const second = await db.senderIdentity.create({
      data: { organizationId: orgA, grantId: grant.id, displayName: "第二寄件人", fromAddress: "second@example.test" },
    });
    const send = async (senderIdentityId: string) => {
      const delivery = await db.emailDelivery.create({
        data: { organizationId: orgA, certificateId: fixture.cert.id, senderIdentityId, toAddress: user.email, messageId: `<${randomUUID()}@example.test>` },
      });
      await processMail(delivery.id, orgA);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const found = await fetch(`${mailpitOrigin}/api/v1/search?query=${encodeURIComponent(`message-id:${delivery.messageId.slice(1, -1)}`)}`);
        const body = (await found.json()) as { messages: { ID: string }[] };
        if (body.messages.length) {
          const message = await (await fetch(`${mailpitOrigin}/api/v1/message/${body.messages[0]!.ID}`)).json();
          return /下載密碼：([A-Z2-9-]{14})/.exec(message.Text)![1]!;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Mailpit did not receive the notification");
    };
    const first = await send(senderA);
    const rotated = await send(second.id);
    expect(rotated).not.toBe(first);
    let address = 1;
    const tryPassword = async (password: string) => {
      const visitor = new Client(`10.30.0.${address++}`);
      await visitor.csrf();
      return visitor.request("POST", "/api/public/certificates/download", { serial: fixture.cert.number, password });
    };
    expect((await tryPassword(first)).statusCode).toBe(403);
    expect((await tryPassword(rotated)).statusCode).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await tryPassword("ZZZZ-ZZZZ-ZZZZ")).statusCode).toBe(403);
    // Locked: even the right password waits, so guessing cannot continue from many addresses.
    expect((await tryPassword(rotated)).statusCode).toBe(429);
    await db.certificate.update({ where: { id: fixture.cert.id }, data: { accessLockedUntil: new Date(Date.now() - 1000) } });
    expect((await tryPassword(rotated)).statusCode).toBe(200);

    const lookup = await app.inject({ method: "GET", url: `/api/public/serials?serial=${encodeURIComponent(fixture.cert.number.toLowerCase())}` });
    expect(lookup.statusCode, lookup.body).toBe(200);
    expect(lookup.headers["x-robots-tag"]).toContain("noindex");
    expect(lookup.json().matches).toEqual([
      expect.objectContaining({ organization: `${prefix} A`, eventName: fixture.batch.eventName, status: "valid" }),
    ]);
    for (const secret of [user.email, "收件人", fixture.cert.id, fixture.cert.publicId, "accessKeyHash"])
      expect(lookup.body).not.toContain(secret);
    expect((await app.inject({ method: "GET", url: `/api/public/serials?serial=${sn("missing")}` })).statusCode).toBe(404);
  });
});

describe("account recovery", () => {
  it("resends activation with cooldown, generic response and invalidates the old token", async () => {
    const { processAccountMail } =
      await import("../../packages/domain/src/account-mail");
    const user = await db.user.create({ data: { email: email("resend") } });
    const oldToken = randomBytes(32).toString("base64url");
    await db.invitation.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(oldToken),
        expiresAt: new Date(Date.now() + 86400e3),
      },
    });
    const client = new Client();
    await client.csrf();
    const known = await client.request("POST", "/api/auth/resend-activation", {
      email: user.email,
    });
    const unknown = await client.request(
      "POST",
      "/api/auth/resend-activation",
      { email: email("absent") },
    );
    expect(known.json()).toEqual(unknown.json());
    await Promise.all(
      [1, 2].map(() =>
        client.request("POST", "/api/auth/resend-activation", {
          email: user.email,
        }),
      ),
    );
    expect(await db.accountMail.count({ where: { userId: user.id } })).toBe(1);
    const job = await db.accountMail.findFirstOrThrow({
      where: { userId: user.id },
    });
    await Promise.all([processAccountMail(job.id), processAccountMail(job.id)]);
    expect(
      (await db.accountMail.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("accepted");
    const mail = await receivedMail(user.email);
    const token = mail.Text.match(/#token=([A-Za-z0-9_-]+)/)![1]!;
    expect(
      (
        await client.request("POST", "/api/auth/activate", {
          token: oldToken,
          password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await client.request("POST", "/api/auth/reset-password", {
          token,
          password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await client.request("POST", "/api/auth/activate", { token, password }))
        .statusCode,
    ).toBe(200);
    expect(
      (await client.request("POST", "/api/auth/activate", { token, password }))
        .statusCode,
    ).toBe(400);
  });

  it("resets once, rejects expired/wrong-purpose tokens, revokes every session and requires new password", async () => {
    const { processAccountMail } =
      await import("../../packages/domain/src/account-mail");
    const user = await db.user.create({
      data: {
        email: email("reset"),
        passwordHash: originalPasswordHash,
        activatedAt: new Date(),
      },
    });
    const first = new Client();
    const second = new Client();
    const anonymous = new Client();
    await first.login(user.email);
    await second.login(user.email);
    await anonymous.csrf();
    const unknown = await anonymous.request(
      "POST",
      "/api/auth/forgot-password",
      { email: email("missing-reset") },
    );
    const known = await anonymous.request("POST", "/api/auth/forgot-password", {
      email: user.email,
    });
    expect(known.json()).toEqual(unknown.json());
    const job = await db.accountMail.findFirstOrThrow({
      where: { userId: user.id },
    });
    await processAccountMail(job.id);
    const mail = await receivedMail(user.email);
    const token = mail.Text.match(/#token=([A-Za-z0-9_-]+)/)![1]!;
    const stored = await db.invitation.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(stored.purpose).toBe("reset");
    expect(
      stored.expiresAt.getTime() - stored.createdAt.getTime(),
    ).toBeLessThanOrEqual(1800e3);
    const expired = randomBytes(32).toString("base64url");
    await db.invitation.create({
      data: {
        userId: user.id,
        purpose: "reset",
        tokenHash: hashToken(expired),
        expiresAt: new Date(0),
      },
    });
    expect(
      (
        await anonymous.request("POST", "/api/auth/reset-password", {
          token: expired,
          password,
        })
      ).statusCode,
    ).toBe(400);
    const nextPassword = "New-Unique-Password-2026!";
    const responses = await Promise.all(
      [1, 2].map(() =>
        anonymous.request("POST", "/api/auth/reset-password", {
          token,
          password: nextPassword,
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect((await first.request("GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await second.request("GET", "/api/auth/me")).statusCode).toBe(401);
    expect(
      (
        await anonymous.request("POST", "/api/auth/login", {
          email: user.email,
          password,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await anonymous.request("POST", "/api/auth/login", {
          email: user.email,
          password: nextPassword,
        })
      ).statusCode,
    ).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not replay ambiguous account SMTP delivery after a worker interruption", async () => {
    const { processAccountMail } =
      await import("../../packages/domain/src/account-mail");
    const job = await db.accountMail.create({
      data: { userId: ownerId, purpose: "reset", status: "sending" },
    });
    await processAccountMail(job.id);
    expect(
      (await db.accountMail.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("unknown");
    expect(
      await db.invitation.count({
        where: { userId: ownerId, purpose: "reset" },
      }),
    ).toBe(0);
  });
});

describe("real worker interruption and failed-row recovery", () => {
  it("recovers a SIGKILLed active BullMQ job and only retries failed rows without replacing successful PDFs", async () => {
    const { spawn } = await import("node:child_process");
    const { Queue } = await import("bullmq");
    const { Pool } = await import("pg");
    const { mkdir } = await import("node:fs/promises");
    const redis = new URL(config.REDIS_URL);
    const queuePrefix = `recovery-${randomUUID()}`;
    const queue = new Queue("certificate-pdf", {
      prefix: queuePrefix,
      connection: {
        host: redis.hostname,
        port: Number(redis.port),
        db: Number(redis.pathname.slice(1) || 0),
      },
    });
    const locks = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
    const lock = await locks.connect();
    const fixture = await createCertificate(
      orgA,
      versionA,
      recipientId,
      "Recovery",
      true,
    );
    const successId = fixture.cert.id;
    const key = `pdf:${successId}`;
    let child: ReturnType<typeof spawn> | undefined;
    const stop = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const ended = new Promise<void>((resolve) =>
          child!.once("exit", () => resolve()),
        );
        child.kill("SIGKILL");
        await ended;
      }
    };
    const start = () => {
      child = spawn(
        process.execPath,
        ["--import", "tsx", "apps/worker/src/index.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: config.DATABASE_URL,
            WORKER_QUEUE_PREFIX: queuePrefix,
          },
          stdio: "pipe",
        },
      );
      child.stderr!.on("data", () => undefined);
      child.stdout!.on("data", () => undefined);
    };
    const until = async (check: () => Promise<boolean>, timeout = 100000) => {
      const deadline = Date.now() + timeout;
      while (!(await check())) {
        if (Date.now() > deadline)
          throw new Error("Recovery verification timed out");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    try {
      await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
        key,
      ]);
      const outbox = await db.outboxEvent.create({
        data: {
          organizationId: orgA,
          kind: "pdf",
          entityId: successId,
          dedupeKey: `drill-${successId}`,
        },
      });
      start();
      await until(
        async () =>
          (await (await queue.getJob(outbox.id))?.getState()) === "active",
      );
      // The process is inside a real queue job, blocked by a DB lock before rendering.
      await stop();
      expect(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: outbox.id } }))
          .completedAt,
      ).toBeNull();
      await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        key,
      ]);
      start();
      await until(
        async () =>
          (await db.outboxEvent.findUniqueOrThrow({ where: { id: outbox.id } }))
            .completedAt !== null,
      );
      const success = await db.certificate.findUniqueOrThrow({
        where: { id: successId },
      });
      expect(success.generationStatus).toBe("success");
      const bytesBefore = await storage.get(success.pdfKey!);
      expect(createHash("sha256").update(bytesBefore).digest("hex")).toBe(
        success.pdfSha256,
      );
      const row = await db.batchRow.create({
        data: {
          organizationId: orgA,
          batchId: fixture.batch.id,
          rowNumber: 3,
          templateVersionId: versionA,
          data: {},
          status: "pending",
        },
      });
      const failedId = randomUUID();
      await db.certificate.create({
        data: {
          id: failedId,
          organizationId: orgA,
          batchId: fixture.batch.id,
          rowId: row.id,
          recipientId: success.recipientId,
          templateVersionId: versionA,
          number: `TEST-${failedId}`,
          dataSnapshot: json(success.dataSnapshot),
        },
      });
      const blockedPath = resolve(
        config.STORAGE_ROOT,
        orgA,
        "certificates",
        `${failedId}.pdf`,
      );
      await mkdir(blockedPath, { recursive: true });
      await db.outboxEvent.create({
        data: {
          organizationId: orgA,
          kind: "pdf",
          entityId: failedId,
          dedupeKey: `drill-${failedId}`,
        },
      });
      await until(
        async () =>
          (await db.certificate.findUniqueOrThrow({ where: { id: failedId } }))
            .generationStatus === "failed",
      );
      expect(
        (
          await db.issuanceBatch.findUniqueOrThrow({
            where: { id: fixture.batch.id },
          })
        ).status,
      ).toBe("failed");
      await rm(blockedPath, { recursive: true });
      const retries = await Promise.all(
        [1, 2].map(() =>
          owner.request(
            "POST",
            `/api/organizations/${orgA}/batches/${fixture.batch.id}/retry`,
          ),
        ),
      );
      expect(retries.map((r) => r.statusCode)).toEqual([200, 200]);
      await until(
        async () =>
          (
            await db.issuanceBatch.findUniqueOrThrow({
              where: { id: fixture.batch.id },
            })
          ).status === "generated",
      );
      expect(
        await db.outboxEvent.count({
          where: { entityId: failedId, dedupeKey: { startsWith: "retry-" } },
        }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({
          where: { entityId: successId, dedupeKey: { startsWith: "retry-" } },
        }),
      ).toBe(0);
      expect(
        await db.certificate.count({ where: { batchId: fixture.batch.id } }),
      ).toBe(2);
      expect(await storage.get(success.pdfKey!)).toEqual(bytesBefore);
      expect(
        (await db.certificate.findUniqueOrThrow({ where: { id: successId } }))
          .pdfSha256,
      ).toBe(success.pdfSha256);
      expect(
        (await queue.getJob(outbox.id))?.stalledCounter,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await stop();
      await lock.query("SELECT pg_advisory_unlock_all()");
      lock.release();
      await locks.end();
      for (const name of ["certificate-mail", "certificate-account"]) {
        const otherQueue = new Queue(name, {
          prefix: queuePrefix,
          connection: {
            host: redis.hostname,
            port: Number(redis.port),
            db: Number(redis.pathname.slice(1) || 0),
          },
        });
        await otherQueue.obliterate({ force: true });
        await otherQueue.close();
      }
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

describe("Excel import and scoped batch downloads", () => {
  it("accepts a real XLSX upload and mapped records, enforces scope, row limits and revalidation", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("中文名單");
    sheet.addRow(["學員姓名", "電子郵件", "發證日期"]);
    sheet.addRow(["王小明", email("xlsx"), new Date("2026-10-15T00:00:00Z")]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const parsed = await owner.upload(
      `/api/organizations/${orgA}/imports/parse`,
      "recipients.xlsx",
      bytes,
    );
    expect(parsed.statusCode, parsed.body).toBe(200);
    expect(parsed.json().sheets[0].rows[0].values[2]).toBe("2026-10-15");
    expect(
      (
        await designer.upload(
          `/api/organizations/${orgA}/imports/parse`,
          "recipients.xlsx",
          bytes,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.upload(
          `/api/organizations/${orgB}/imports/parse`,
          "recipients.xlsx",
          bytes,
        )
      ).statusCode,
    ).toBe(403);
    const records = [
      {
        rowNumber: 1,
        data: {
          recipient_name: "王小明",
          recipient_email: email("xlsx"),
          certificate_number: sn("xlsx"),
          issue_date: "2026-10-15",
        },
      },
    ];
    const input = {
      templateVersionId: versionA,
      eventName: "Excel 欄位對應驗證",
      records,
    };
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/validate`,
          input,
        )
      ).json().valid,
    ).toBe(true);
    const key = randomUUID();
    const created = await owner.request(
      "POST",
      `/api/organizations/${orgA}/batches`,
      { ...input, idempotencyKey: key },
    );
    expect(created.statusCode, created.body).toBe(200);
    expect(
      (
        await owner.request("POST", `/api/organizations/${orgA}/batches`, {
          ...input,
          idempotencyKey: key,
        })
      ).json().id,
    ).toBe(created.json().id);
    expect(
      (
        await db.batchRow.findFirstOrThrow({
          where: { batchId: created.json().id },
        })
      ).data,
    ).toEqual(records[0]!.data);
    expect(
      (
        await owner.request("POST", `/api/organizations/${orgA}/batches`, {
          ...input,
          records: [
            {
              rowNumber: 2,
              data: { recipient_name: "王小明", recipient_email: "bad", certificate_number: sn("bad") },
            },
          ],
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/validate`,
          { ...input, templateVersionId: versionB },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/validate`,
          {
            ...input,
            csv: `recipient_name,recipient_email,certificate_number\n王小明,a@example.test,${sn("csv")}`,
          },
        )
      ).statusCode,
    ).toBe(400);
    const searched = await owner.request(
      "GET",
      `/api/organizations/${orgA}/batches?search=${encodeURIComponent("Excel 欄位對應")}&status=validated`,
    );
    expect(searched.json().items.map((b: { id: string }) => b.id)).toEqual([
      created.json().id,
    ]);
  });

  it("downloads only successful valid PDFs, rejects foreign selections, verifies hashes and exports safe failure reports", async () => {
    const { unzipSync } = await import("fflate");
    const { parse } = await import("csv-parse/sync");
    const fixture = await createCertificate(
      orgA,
      versionA,
      recipientId,
      "ZIP",
      true,
    );
    await processPdf(fixture.cert.id, orgA);
    const cert = await db.certificate.findUniqueOrThrow({
      where: { id: fixture.cert.id },
    });
    const failed = await db.batchRow.create({
      data: {
        organizationId: orgA,
        batchId: fixture.batch.id,
        rowNumber: 9,
        templateVersionId: versionA,
        status: "failed",
        error: '第一行\n第二行,"錯誤"',
        data: {
          recipient_name: '=HYPERLINK("bad")',
          recipient_email: email("failed-report"),
        },
      },
    });
    const path = `/api/organizations/${orgA}/batches/${fixture.batch.id}`;
    const zipped = await owner.request("POST", `${path}/zip`, {});
    expect(zipped.statusCode, zipped.body.slice(0, 100)).toBe(200);
    expect(zipped.headers["content-type"]).toContain("application/zip");
    expect(zipped.headers["cache-control"]).toBe("no-store");
    const entries = unzipSync(zipped.rawPayload);
    expect(Object.keys(entries)).toHaveLength(1);
    expect(Object.keys(entries)[0]).not.toContain("/");
    expect(Buffer.from(Object.values(entries)[0]!)).toEqual(
      await storage.get(cert.pdfKey!),
    );
    expect(
      (await owner.request("POST", `${path}/zip`, { certificateIds: [certB] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await owner.request(
          "POST",
          `/api/organizations/${orgA}/batches/${batchB}/zip`,
          {},
        )
      ).statusCode,
    ).toBe(404);
    expect((await designer.request("POST", `${path}/zip`, {})).statusCode).toBe(
      403,
    );
    expect(
      (await designer.request("GET", `${path}/failures.csv`)).statusCode,
    ).toBe(403);
    const report = await owner.request("GET", `${path}/failures.csv`);
    expect(report.statusCode).toBe(200);
    const parsed = parse(report.body, { bom: true }) as string[][];
    expect(parsed).toHaveLength(2);
    expect(parsed[1]![0]).toBe(String(failed.rowNumber));
    expect(parsed[1]![1]).toBe('\'=HYPERLINK("bad")');
    expect(parsed[1]![5]).toBe('第一行\n第二行,"錯誤"');
    await db.certificate.update({
      where: { id: cert.id },
      data: { status: "revoked" },
    });
    expect((await owner.request("POST", `${path}/zip`, {})).statusCode).toBe(
      400,
    );
    await db.certificate.update({
      where: { id: cert.id },
      data: { status: "valid" },
    });
    const original = await storage.get(cert.pdfKey!);
    await storage.put(cert.pdfKey!, Buffer.from("corrupt"));
    expect((await owner.request("POST", `${path}/zip`, {})).statusCode).toBe(
      409,
    );
    await storage.put(cert.pdfKey!, original);
    expect(
      await db.auditLog.count({
        where: {
          organizationId: orgA,
          resourceId: fixture.batch.id,
          action: "batch.zip_downloaded",
        },
      }),
    ).toBe(1);
  });
});

it("keeps signed workspace sessions independent behind one IP while retaining auth IP limits", async () => {
  const address = "127.0.0.240";
  const first = new Client(address);
  const second = new Client(address);
  await first.login(email("owner"));
  await second.login(email("recipient"));
  for (let i = 0; i < 120; i++)
    expect((await first.request("GET", "/api/health")).statusCode).toBe(200);
  expect((await first.request("GET", "/api/health")).statusCode).toBe(429);
  expect((await second.request("GET", "/api/health")).statusCode).toBe(200);
  // The eight-login budget is shared by the IP even when cookies identify separate sessions.
  for (let i = 0; i < 6; i++)
    expect(
      (
        await (i % 2 ? first : second).request("POST", "/api/auth/login", {
          email: email("owner"),
          password: "invalid",
        })
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await second.request("POST", "/api/auth/login", {
        email: email("owner"),
        password,
      })
    ).statusCode,
  ).toBe(429);
});

describe('issuance lifecycle', () => {
  it('edits draft data atomically, rejects stale updates, clears preview and records before/after', async () => {
    const created = await owner.request('POST', `/api/organizations/${orgA}/batches`, { templateVersionId: versionA, eventName: '修改前', records: [{ rowNumber: 1, data: { recipient_name: '原姓名', recipient_email: email('edit'), certificate_number: sn('edit') } }], idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().id;
    await db.issuanceBatch.update({ where: { id }, data: { previewedAt: new Date() } });
    const body = { revision: 1, eventName: '修改後', reason: '修正活動名稱及姓名', records: [{ rowNumber: 1, data: { recipient_name: '新姓名', recipient_email: email('edit'), certificate_number: sn('edit') } }] };
    const responses = await Promise.all([owner.request('PUT', `/api/organizations/${orgA}/batches/${id}`, body), owner.request('PUT', `/api/organizations/${orgA}/batches/${id}`, body)]);
    expect(responses.map(r => r.statusCode).sort(), `${responses.map(r => r.body).join('\n')}\n${lastServerError?.message ?? ''}`).toEqual([200,409]);
    const b = await db.issuanceBatch.findUniqueOrThrow({ where: { id }, include: { rows: true } });
    expect(b.previewedAt).toBeNull(); expect(b.revision).toBe(2); expect(b.rows).toHaveLength(1);
    expect((b.rows[0]!.data as Record<string,string>).recipient_name).toBe('新姓名');
    expect((await owner.request('POST', `/api/organizations/${orgA}/batches/${id}/generate`)).statusCode).toBe(409);
    const history = await owner.request('GET', `/api/organizations/${orgA}/batches/${id}/history`);
    const edit = history.json().items.find((a: { action: string }) => a.action === 'batch.edited');
    await expect(db.auditLog.update({ where: { id: edit.id }, data: { action: 'tampered' } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: edit.id } })).rejects.toThrow();
    expect(edit.metadata.before.eventName).toBe('修改前'); expect(edit.metadata.after.eventName).toBe('修改後'); expect(edit.metadata.actorEmail).toBe(email('owner'));
    expect((await owner.request('PUT', `/api/organizations/${orgB}/batches/${id}`, body)).statusCode).toBe(403);
    expect((await designer.request('PUT', `/api/organizations/${orgA}/batches/${id}`, body)).statusCode).toBe(403);
  });
  it('cancels pending work and queued mail, preserves cancellation after stale worker executions', async () => {
    const fixture = await createCertificate(orgA, versionA, recipientId, 'cancel', true);
    const delivery = await db.emailDelivery.create({ data: { organizationId: orgA, certificateId: fixture.cert.id, senderIdentityId: senderA, toAddress: email('recipient'), messageId: `${randomUUID()}@test` } });
    const url = `/api/organizations/${orgA}/batches/${fixture.batch.id}`;
    const result = await owner.request('POST', `${url}/cancel`, { reason: '活動停辦', revision: 1 });
    expect(result.statusCode, result.body).toBe(200); expect(result.json().queuedCancelled).toBe(1);
    await processPdf(fixture.cert.id, orgA); await processMail(delivery.id, orgA);
    expect((await db.issuanceBatch.findUniqueOrThrow({ where: { id: fixture.batch.id } })).status).toBe('cancelled');
    expect((await db.certificate.findUniqueOrThrow({ where: { id: fixture.cert.id } })).generationStatus).toBe('cancelled');
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('cancelled');
    for (const operation of ['generate','retry','send']) expect((await owner.request('POST', `${url}/${operation}`, operation === 'send' ? { senderIdentityId: senderA } : {})).statusCode).toBe(409);
    expect((await owner.request('POST', `${url}/cancel`, { reason: '重複點擊', revision: 1 })).statusCode).toBe(200);
    expect(await db.auditLog.count({ where: { resourceId: fixture.batch.id, action: 'batch.cancelled' } })).toBe(1);
  });
  it('revokes downloads and reissues once with immutable old bytes, the same serial and full lineage', async () => {
    const fixture = await createCertificate(orgA, versionA, recipientId, 'reissue', true);
    await processPdf(fixture.cert.id, orgA);
    expect((await owner.request('POST', `/api/organizations/${orgA}/certificates/${certB}/revoke`, { reason: '跨組織' })).statusCode).toBe(404);
    const old = await db.certificate.findUniqueOrThrow({ where: { id: fixture.cert.id } });
    const bytes = await storage.get(old.pdfKey!);
    const url = `/api/organizations/${orgA}/certificates/${old.id}`;
    expect((await designer.request('POST', `${url}/revoke`, { reason: '撤銷' })).statusCode).toBe(403);
    expect((await owner.request('POST', `${url}/revoke`, { reason: '' })).statusCode).toBe(400);
    expect((await owner.request('POST', `${url}/revoke`, { reason: '姓名有誤' })).statusCode).toBe(200);
    expect((await owner.request('GET', `${url}/pdf`)).statusCode).toBe(404);
    expect((await recipient.request('GET', `/api/me/certificates/${old.id}/pdf`)).statusCode).toBe(404);
    const body = { reason: '更正姓名後補發', data: { recipient_name: '更正姓名', recipient_email: email('recipient') } };
    const responses = await Promise.all([owner.request('POST', `${url}/reissue`, body), owner.request('POST', `${url}/reissue`, body)]);
    expect(responses.map(r => r.statusCode).sort(), responses.map(r => r.body).join('\n')).toEqual([200,409]);
    const next = await db.certificate.findFirstOrThrow({ where: { previousCertificateId: old.id } });
    expect(next.edition).toBe(2); expect(next.number).toBe(old.number); expect(next.rowId).toBe(old.rowId);
    await processPdf(next.id, orgA); await processPdf(old.id, orgA);
    expect(await storage.get(old.pdfKey!)).toEqual(bytes);
    expect((await db.certificate.findUniqueOrThrow({ where: { id: old.id } })).dataSnapshot).toEqual(old.dataSnapshot);
    const batch = await owner.request('GET', `/api/organizations/${orgA}/batches/${old.batchId}`);
    expect(batch.json().rows).toHaveLength(1); expect(batch.json().rows[0].certificate.id).toBe(next.id); expect(batch.json().rows[0].history).toHaveLength(2);
    expect((await owner.request('GET', `/api/organizations/${orgA}/certificates/${next.id}/pdf`)).statusCode).toBe(200);
    expect((await owner.request('POST', `/api/organizations/${orgB}/certificates/${next.id}/revoke`, { reason: '跨組織' })).statusCode).toBe(403);
    const history = (await owner.request('GET', `/api/organizations/${orgA}/batches/${old.batchId}/history`)).json().items;
    expect(history.find((a: { action: string }) => a.action === 'certificate.reissued').metadata.before.id).toBe(old.id);
    expect(history.find((a: { action: string }) => a.action === 'certificate.reissued').metadata.after.id).toBe(next.id);
    const final = await owner.request('POST', `/api/organizations/${orgA}/batches/${old.batchId}/cancel`, { revision: batch.json().revision, reason: '活動撤回' });
    expect(final.statusCode).toBe(200);
    expect((await owner.request('GET', `/api/organizations/${orgA}/certificates/${next.id}/pdf`)).statusCode).toBe(404);
    expect((await owner.request('POST', `/api/organizations/${orgA}/certificates/${next.id}/reissue`, body)).statusCode).toBe(409);
  });
});

it('supersedes a valid edition, retains in-flight notification outcomes and cancels the replacement', async () => {
  const fixture = await createCertificate(orgA, versionA, recipientId, 'superseded');
  const delivery = await db.emailDelivery.create({ data: { organizationId: orgA, certificateId: fixture.cert.id, senderIdentityId: senderA, toAddress: email('recipient'), messageId: `${randomUUID()}@test`, status: 'sending' } });
  const attempt = await db.deliveryAttempt.create({ data: { organizationId: orgA, deliveryId: delivery.id, status: 'sending' } });
  const path = `/api/organizations/${orgA}/batches/${fixture.batch.id}`;
  const edit = await owner.request('PUT', path, { reason: '不可修改已產製活動', revision: 1, eventName: '新活動名稱', records: [{ rowNumber: 1, data: { recipient_name: '學生', recipient_email: email('recipient'), certificate_number: sn('locked') } }] });
  expect(edit.statusCode).toBe(409);
  const result = await owner.request('POST', `/api/organizations/${orgA}/certificates/${fixture.cert.id}/reissue`, { reason: '原證書補發' });
  expect(result.statusCode, result.body).toBe(200);
  expect((await db.certificate.findUniqueOrThrow({ where: { id: fixture.cert.id } })).status).toBe('superseded');
  const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: result.json().certificateId, action: 'certificate.reissued' } });
  expect((audit.metadata as { inFlight: number }).inFlight).toBe(1);
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('sending');
  await processMail(delivery.id, orgA);
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('unknown');
  expect((await db.deliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('unknown');
  const report = await owner.request('GET', `${path}/failures.csv`);
  expect(report.body).toContain(fixture.cert.number);
  const replacement = await db.certificate.findUniqueOrThrow({ where: { id: result.json().certificateId } });
  // The replacement keeps the serial, so the report row is told apart by its stage, not its number.
  expect(replacement.number).toBe(fixture.cert.number);
  expect((await owner.request('POST', `${path}/cancel`, { reason: '取消補發', revision: 2 })).statusCode).toBe(200);
  await processPdf(result.json().certificateId, orgA);
  expect((await db.issuanceBatch.findUniqueOrThrow({ where: { id: fixture.batch.id } })).status).toBe('cancelled');
});

describe('public serial lookup and expiration', () => {
  const lookup = (serial: string) => app.inject({ method: 'GET', url: `/api/public/serials?serial=${encodeURIComponent(serial)}` });
  it('confirms a serial with minimal public metadata, hides pending ones, retires the QR link and reports expiry at the boundary', async () => {
    const fixture = await createCertificate(orgA, versionA, recipientId, 'public-verification');
    const result = await lookup(fixture.cert.number);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['x-robots-tag']).toContain('noindex');
    expect(Object.keys(result.json()).sort()).toEqual(['checkedAt', 'matches', 'serial']);
    expect(result.json().matches).toHaveLength(1);
    expect(Object.keys(result.json().matches[0]).sort()).toEqual(['eventName', 'expiresAt', 'issueDate', 'organization', 'status']);
    expect(result.json().matches[0].status).toBe('valid');
    for (const secret of [email('recipient'), '收件人', orgA, fixture.cert.publicId, fixture.cert.pdfKey!]) expect(result.body).not.toContain(secret);
    expect((await lookup(sn('unknown'))).statusCode).toBe(404);
    expect((await lookup('')).statusCode).toBe(400);
    const pending = await createCertificate(orgA, versionA, recipientId, 'not-yet-public', true);
    expect((await lookup(pending.cert.number)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/public/certificates/${fixture.cert.publicId}` })).statusCode).toBe(404);
    const { certificateStatus, expiryInstant } = await import('../../packages/domain/src/verification');
    const cutoff = expiryInstant('2030-06-01')!;
    expect(cutoff.toISOString()).toBe('2030-06-01T15:59:59.999Z');
    expect(certificateStatus({ ...fixture.cert, expiresAt: cutoff }, new Date(cutoff.getTime()-1))).toBe('valid');
    expect(certificateStatus({ ...fixture.cert, expiresAt: cutoff }, cutoff)).toBe('expired');
    await expect(db.certificate.update({ where: { id: fixture.cert.id }, data: { publicId: randomUUID() } })).rejects.toThrow();
  });
  it('changes expiry with audit and conflict protection, blocks expired downloads/ZIP/mail and permits renewal', async () => {
    const fixture = await createCertificate(orgA, versionA, recipientId, 'expiration', true);
    await processPdf(fixture.cert.id, orgA);
    const c = await db.certificate.findUniqueOrThrow({ where: { id: fixture.cert.id } });
    const bytes = await storage.get(c.pdfKey!);
    const url = `/api/organizations/${orgA}/certificates/${c.id}`;
    const body = { expiresOn: '2000-01-01', reason: '設定已到期期限', revision: 1 };
    expect((await designer.request('POST', `${url}/expiry`, body)).statusCode).toBe(403);
    expect((await owner.request('POST', `/api/organizations/${orgA}/certificates/${certB}/expiry`, body)).statusCode).toBe(404);
    const results = await Promise.all([owner.request('POST', `${url}/expiry`, body), owner.request('POST', `${url}/expiry`, body)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200,409]);
    expect((await lookup(c.number)).json().matches[0].status).toBe('expired');
    expect((await owner.request('GET', `${url}/pdf`)).statusCode).toBe(404);
    expect((await recipient.request('GET', `/api/me/certificates/${c.id}/pdf`)).statusCode).toBe(404);
    expect((await owner.request('POST', `/api/organizations/${orgA}/batches/${c.batchId}/zip`, { certificateIds: [c.id] })).statusCode).toBe(400);
    expect((await owner.request('POST', `/api/organizations/${orgA}/batches/${c.batchId}/send`, { senderIdentityId: senderA })).statusCode).toBe(409);
    const delivery = await db.emailDelivery.create({ data: { organizationId: orgA, certificateId: c.id, senderIdentityId: senderA, toAddress: email('recipient'), messageId: `${randomUUID()}@test` } });
    await processMail(delivery.id, orgA);
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).not.toBe('accepted');
    expect((await owner.request('POST', `${url}/expiry`, { expiresOn: '2099-12-31', reason: '續期', revision: 2 })).statusCode).toBe(200);
    expect((await lookup(c.number)).json().matches[0].status).toBe('valid');
    expect((await owner.request('GET', `${url}/pdf`)).statusCode).toBe(200);
    expect(await storage.get(c.pdfKey!)).toEqual(bytes);
    const audit = await db.auditLog.findMany({ where: { resourceId: c.id, action: 'certificate.expiry_changed' } });
    expect(audit).toHaveLength(2); expect(JSON.stringify(audit)).toContain('續期');
    expect((await owner.request('POST', `${url}/revoke`, { reason: '資格撤回' })).statusCode).toBe(200);
    expect((await lookup(c.number)).json().matches[0].status).toBe('revoked');
    expect((await owner.request('POST', `${url}/expiry`, { expiresOn: null, reason: '不得藉由續期解除撤銷', revision: 3 })).statusCode).toBe(409);
  });
  it('keeps the serial and password on a reissue, shows only the newest edition, and inherits batch expiry', async () => {
    const created = await owner.request('POST', `/api/organizations/${orgA}/batches`, { templateVersionId: versionA, eventName: '效期活動', expiresOn: '2099-06-01', records: [{ rowNumber: 1, data: { recipient_name: '期限學員', recipient_email: email('recipient'), certificate_number: sn('expiry') } }], idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(200);
    const batchId = created.json().id;
    await db.issuanceBatch.update({ where: { id: batchId }, data: { previewedAt: new Date() } });
    expect((await owner.request('POST', `/api/organizations/${orgA}/batches/${batchId}/generate`)).statusCode).toBe(200);
    const c = await db.certificate.findFirstOrThrow({ where: { batchId } });
    expect(c.number).toBe(sn('expiry'));
    expect(c.expiresAt?.toISOString()).toBe('2099-06-01T15:59:59.999Z');
    expect(c.dataSnapshot as Record<string,string>).not.toHaveProperty('verification_url');
    await processPdf(c.id, orgA);
    await db.certificate.update({ where: { id: c.id }, data: { accessKeyHash: '$argon2id$fixture' } });
    const next = await owner.request('POST', `/api/organizations/${orgA}/certificates/${c.id}/reissue`, { reason: '提供新版', expiresOn: null });
    expect(next.statusCode, next.body).toBe(200);
    const replacement = await db.certificate.findUniqueOrThrow({ where: { id: next.json().certificateId } });
    expect(replacement.expiresAt).toBeNull(); expect(replacement.publicId).not.toBe(c.publicId);
    expect(replacement.number).toBe(c.number);
    expect(replacement.accessKeyHash).toBe('$argon2id$fixture');
    await processPdf(replacement.id, orgA);
    const current = await lookup(c.number);
    expect(current.json().matches).toHaveLength(1);
    expect(current.json().matches[0]).toMatchObject({ status: 'valid', expiresAt: null });
    await db.organization.update({ where: { id: orgA }, data: { active: false } });
    try { expect((await lookup(c.number)).json().matches[0].status).toBe('unavailable'); }
    finally { await db.organization.update({ where: { id: orgA }, data: { active: true } }); }
  });
});

it('keeps the signed CSRF token stable across tabs without weakening rejection of forged requests', async () => {
  const first = await owner.request('GET', '/api/auth/csrf');
  const second = await owner.request('GET', '/api/auth/csrf');
  expect(first.json().csrfToken).toBe(second.json().csrfToken);
  expect(first.json().csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect((await owner.request('POST', `/api/organizations/${orgA}/batches/${randomUUID()}/cancel`, { reason: 'test', revision: 1 }, { csrf: false })).statusCode).toBe(403);
});

describe('preview conflicts and notification retry', () => {
  it('keeps 409 when the batch changes while a preview is rendering (BUG-001)', async () => {
    const created = await owner.request('POST', `/api/organizations/${orgA}/batches`, { templateVersionId: versionA, eventName: '預覽衝突', records: [{ rowNumber: 1, data: { recipient_name: '預覽學員', recipient_email: email('preview'), certificate_number: sn('preview') } }], idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(200);
    const batchId = created.json().id;
    const row = await db.batchRow.findFirstOrThrow({ where: { batchId } });
    let pending: ReturnType<Client['request']> | undefined;
    // Hold an uncommitted revision bump: the preview reads the old revision, renders, then blocks on the row lock.
    await db.$transaction(async (tx) => {
      await tx.issuanceBatch.update({ where: { id: batchId }, data: { revision: { increment: 1 } } });
      pending = owner.request('POST', `/api/organizations/${orgA}/batches/${batchId}/preview`, { rowId: row.id });
      for (let i = 0; i < 600; i += 1) {
        const [waiting] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%IssuanceBatch%'`;
        if (Number(waiting!.count) > 0) return;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('preview never reached the conditional update');
    }, { timeout: 60000 });
    const preview = await pending!;
    expect(preview.statusCode, preview.body).toBe(409);
    expect(preview.json().message).toBe('活動已變更，請重新預覽');
    expect((await db.issuanceBatch.findUniqueOrThrow({ where: { id: batchId } })).previewedAt).toBeNull();
  });

  it('reports skipped notifications and retries only failed/cancelled ones once with a reason (BUG-002)', async () => {
    const fixture = await createCertificate(orgA, versionA, recipientId, 'mail-retry');
    const url = `/api/organizations/${orgA}/batches/${fixture.batch.id}`;
    const first = await owner.request('POST', `${url}/send`, { senderIdentityId: senderA });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().queued).toBe(1);
    const delivery = await db.emailDelivery.findFirstOrThrow({ where: { certificateId: fixture.cert.id } });
    // Simulate the worker having cancelled it while the certificate was expired, then a renewal.
    await db.emailDelivery.update({ where: { id: delivery.id }, data: { status: 'cancelled', error: '證書已失效或到期' } });
    await db.deliveryAttempt.create({ data: { organizationId: orgA, deliveryId: delivery.id, status: 'failed', errorClass: 'permanent', smtpCode: 550, endedAt: new Date() } });
    const resend = await owner.request('POST', `${url}/send`, { senderIdentityId: senderA });
    expect(resend.statusCode, resend.body).toBe(200);
    expect(resend.json().queued).toBe(0);
    expect(resend.json().skipped.cancelled).toBe(1);
    expect(resend.json().message).toContain('重試失敗通知');
    expect(await db.outboxEvent.count({ where: { kind: 'mail', entityId: delivery.id } })).toBe(1);

    expect((await designer.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA, reason: '續期後重寄' })).statusCode).toBe(403);
    expect((await owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA })).statusCode).toBe(400);
    expect((await owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderB, reason: '續期後重寄' })).statusCode).toBe(403);
    const results = await Promise.all([
      owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA, reason: '續期後重寄' }),
      owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA, reason: '續期後重寄' }),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find(r => r.statusCode === 200)!.json().queued).toBe(1);
    expect(await db.outboxEvent.count({ where: { kind: 'mail', entityId: delivery.id } })).toBe(2);
    const requeued = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id }, include: { attempts: true } });
    expect(requeued.status).toBe('queued'); expect(requeued.error).toBeNull(); expect(requeued.attempts).toHaveLength(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: fixture.batch.id, action: 'batch.mail_retry_requested' } });
    expect(JSON.stringify(audit.metadata)).toContain('續期後重寄');
    expect(JSON.stringify(audit.metadata)).toContain('cancelled');

    await processMail(delivery.id, orgA);
    const sent = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id }, include: { attempts: true } });
    expect(sent.status).toBe('accepted'); expect(sent.attempts).toHaveLength(2);
    expect((await owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA, reason: '不應重寄' })).statusCode).toBe(409);

    await db.emailDelivery.update({ where: { id: delivery.id }, data: { status: 'unknown' } });
    const ambiguous = await owner.request('POST', `${url}/deliveries/retry`, { senderIdentityId: senderA, reason: '不應盲目重寄' });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json().message).toContain('人工核對');
    expect(await db.outboxEvent.count({ where: { kind: 'mail', entityId: delivery.id } })).toBe(2);
  });
});

describe('certificate serial numbers, built-in fields and PDF backgrounds', () => {
  it('takes serials from the list, numbers recipients from 1, and refuses duplicates, blanks and serials used elsewhere in the organization', async () => {
    const path = `/api/organizations/${orgA}/batches`;
    const checked = await owner.request('POST', `${path}/validate`, {
      templateVersionId: versionA,
      eventName: '流水號檢查',
      csv: `recipient_name,recipient_email,certificate_number\n甲,${email('s-a')},${sn('imp-x')}\n乙,${email('s-b')},${sn('imp-x').toLowerCase()}\n丙,${email('s-c')},`,
    });
    expect(checked.statusCode, checked.body).toBe(200);
    const rows = checked.json().rows as { rowNumber: number; errors: { field: string; message: string }[] }[];
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors).toContainEqual({ field: 'certificate_number', message: '與第 1 筆的流水號重複' });
    expect(rows[2]!.errors).toContainEqual({ field: 'certificate_number', message: '證書流水號必填' });

    const created = await owner.request('POST', path, {
      templateVersionId: versionA,
      eventName: '流水號活動',
      csv: `recipient_name,recipient_email,certificate_number\n流水一,${email('serial-1')},${sn('imp-1').toLowerCase()}\n流水二,${email('serial-2')},${sn('imp-2')}`,
      idempotencyKey: randomUUID(),
    });
    expect(created.statusCode, created.body).toBe(200);
    const batchId = created.json().id;
    const batchRows = await db.batchRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } });
    expect(batchRows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect((await owner.request('POST', `${path}/${batchId}/preview`, { rowId: batchRows[0]!.id })).statusCode).toBe(200);
    // A serial waiting in an event that has not generated yet is already taken.
    const clash = { templateVersionId: versionA, eventName: '撞號', records: [{ rowNumber: 1, data: { recipient_name: '撞號', recipient_email: email('clash'), certificate_number: sn('imp-1') } }] };
    const clashCheck = await owner.request('POST', `${path}/validate`, clash);
    expect(clashCheck.json().rows[0].errors).toContainEqual({ field: 'certificate_number', message: '這個流水號已被其他證書或活動使用' });
    expect((await owner.request('POST', path, { ...clash, idempotencyKey: randomUUID() })).statusCode).toBe(400);
    expect((await owner.request('POST', `${path}/${batchId}/generate`)).statusCode).toBe(200);
    expect((await owner.request('POST', `${path}/${batchId}/generate`)).statusCode).toBe(200);
    const certificates = await db.certificate.findMany({ where: { batchId }, include: { row: true }, orderBy: { row: { rowNumber: 'asc' } } });
    expect(certificates.map((c) => c.number)).toEqual([sn('imp-1'), sn('imp-2')]);
    for (const c of certificates) expect((c.dataSnapshot as Record<string, string>).certificate_number).toBe(c.number);
    expect((await owner.request('POST', `${path}/validate`, clash)).json().valid).toBe(false);

    // A cancelled event that never issued gives its serials back.
    const cancelled = await owner.request('POST', path, { templateVersionId: versionA, eventName: '取消活動', records: [{ rowNumber: 1, data: { recipient_name: '取消', recipient_email: email('cancel-serial'), certificate_number: sn('imp-3') } }], idempotencyKey: randomUUID() });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await owner.request('POST', `${path}/${cancelled.json().id}/cancel`, { revision: 1, reason: '改期' })).statusCode).toBe(200);
    expect((await owner.request('POST', `${path}/validate`, { ...clash, records: [{ ...clash.records[0]!, data: { ...clash.records[0]!.data, certificate_number: sn('imp-3') } }] })).json().valid).toBe(true);

    // The database refuses one serial on two different rows of an organization.
    const other = await db.batchRow.create({ data: { organizationId: orgA, batchId, rowNumber: 99, templateVersionId: versionA, data: {} } });
    await expect(db.certificate.create({ data: { organizationId: orgA, batchId, rowId: other.id, recipientId: certificates[0]!.recipientId, templateVersionId: versionA, number: sn('imp-1'), dataSnapshot: {} } })).rejects.toThrow();
    await db.batchRow.delete({ where: { id: other.id } });
  });

  it('mixes templates in one event, picking each recipient\'s template by name and checking that template\'s fields', async () => {
    const hours = createDefaultDocument();
    hours.fields.push({ key: 'hours', label: '時數', type: 'number', required: true });
    hours.elements[3]!.text = '完成 {{event_name}} 共 {{hours}} 小時';
    const second = await createPublishedTemplate(orgA, `時數證明 ${runSerial}`, hours);
    const same = await db.templateVersion.create({ data: { organizationId: orgA, templateId: second.template.id, number: 2, document: json(hours), rendererVersion: '1', assetManifest: { font: { version: FONT_ASSET_VERSION, sha256: FONT_SHA256 }, background: null } } });
    const path = `/api/organizations/${orgA}/batches`;
    expect((await owner.request('POST', `${path}/validate`, { templateVersionIds: [second.version.id, same.id], eventName: '同模板兩版', records: [{ rowNumber: 1, data: {} }] })).statusCode).toBe(400);
    const nameA = (await db.templateVersion.findUniqueOrThrow({ where: { id: versionA }, include: { template: true } })).template.name;
    const csv = (hoursValue: string) => `recipient_name,recipient_email,certificate_number,template,hours\n結業,${email('mix-1')},${sn('mix-1')},${nameA},\n時數,${email('mix-2')},${sn('mix-2')}, 時數證明 ${runSerial} ,${hoursValue}`;
    const input = { templateVersionIds: [versionA, second.version.id], eventName: '混合模板' };
    const missing = await owner.request('POST', `${path}/validate`, { ...input, csv: csv('') });
    const fine = await owner.request('POST', `${path}/validate`, { ...input, csv: csv('12') });
    expect(fine.json().valid, JSON.stringify(fine.json().rows.map((r: { errors: unknown }) => r.errors))).toBe(true);
    expect(missing.json().rows[1].errors.map((e: { field: string }) => e.field)).toContain('hours');
    expect(missing.json().templates.map((t: { id: string }) => t.id)).toEqual([versionA, second.version.id]);
    const created = await owner.request('POST', path, { ...input, csv: csv('12'), idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(200);
    const batchId = created.json().id;
    const rows = await db.batchRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } });
    expect(rows.map((r) => r.templateVersionId)).toEqual([versionA, second.version.id]);
    expect(rows[1]!.data).not.toHaveProperty('template');
    const preview = await owner.request('POST', `${path}/${batchId}/preview`, { rowId: rows[1]!.id });
    expect(preview.statusCode, preview.body.slice(0, 200)).toBe(200);
    expect((await owner.request('POST', `${path}/${batchId}/generate`)).statusCode).toBe(200);
    const certificates = await db.certificate.findMany({ where: { batchId }, include: { row: true }, orderBy: { row: { rowNumber: 'asc' } } });
    expect(certificates.map((c) => c.templateVersionId)).toEqual([versionA, second.version.id]);
    const detail = (await owner.request('GET', `${path}/${batchId}`)).json();
    expect(detail.templates.map((t: { name: string }) => t.name)).toEqual([nameA, `時數證明 ${runSerial}`]);
    expect(detail.rows[1].templateName).toBe(`時數證明 ${runSerial}`);
    expect(JSON.stringify(detail)).not.toContain('verificationUrl');
  });

  it('gives each organization a short editable workspace address', async () => {
    const path = `/api/organizations/${orgA}/settings`;
    const slug = `t-${runSerial.toLowerCase()}`;
    expect((await designer.request('PUT', path, { slug })).statusCode).toBe(403);
    for (const bad of ['login', 'A', '-abc', 'has space']) expect((await owner.request('PUT', path, { slug: bad })).statusCode).toBe(400);
    const saved = await owner.request('PUT', path, { slug: slug.toUpperCase() });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().slug).toBe(slug);
    const me = (await owner.request('GET', '/api/auth/me')).json();
    expect(me.memberships.find((m: { organization: { id: string } }) => m.organization.id === orgA).organization.slug).toBe(slug);
    await db.organization.update({ where: { id: orgB }, data: { slug: `${slug}-b` } });
    expect((await owner.request('PUT', path, { slug: `${slug}-b` })).statusCode).toBe(409);
    expect(await db.auditLog.count({ where: { organizationId: orgA, action: 'organization.slug_updated' } })).toBe(1);
  });

  it('adds the built-in serial field to every saved template and accepts custom fields', async () => {
    const legacy = createDefaultDocument();
    legacy.fields = legacy.fields.filter((field) => field.key !== 'certificate_number');
    legacy.elements = legacy.elements.filter((element) => !element.text.includes('certificate_number'));
    legacy.fields.push({ key: 'hours', label: '課程時數', type: 'number', required: true });
    legacy.elements.push({ ...legacy.elements[0]!, id: 'hours', text: '共 {{hours}} 小時' });
    const created = await owner.request('POST', `/api/organizations/${orgA}/templates`, { name: '自訂欄位模板', document: legacy });
    expect(created.statusCode, created.body).toBe(200);
    const saved = await db.template.findUniqueOrThrow({ where: { id: created.json().id } });
    const keys = (saved.document as TemplateDocument).fields.map((field) => field.key);
    expect(keys).toContain('certificate_number');
    expect(keys).toContain('hours');
  });

  it('keeps a PDF background as vectors on issued certificates, with a PNG preview, and rejects broken PDFs', async () => {
    const created = await owner.request('POST', `/api/organizations/${orgA}/batches`, {
      templateVersionId: versionA,
      eventName: 'PDF 背景',
      csv: `recipient_name,recipient_email,certificate_number\n背景,${email('pdf-bg')},${sn('bg')}`,
      idempotencyKey: randomUUID(),
    });
    const row = await db.batchRow.findFirstOrThrow({ where: { batchId: created.json().id } });
    const pdf = (await owner.request('POST', `/api/organizations/${orgA}/batches/${created.json().id}/preview`, { rowId: row.id })).rawPayload;
    const uploaded = await owner.upload(`/api/organizations/${orgA}/assets`, 'background.pdf', pdf);
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    expect(uploaded.json()).toMatchObject({ mimeType: 'image/png', source: 'pdf', pdfPages: 1 });
    expect(uploaded.json().width).toBeGreaterThan(uploaded.json().height);
    const asset = await db.asset.findUniqueOrThrow({ where: { id: uploaded.json().id } });
    const stored = await storage.get(asset.storageKey);
    expect((await sharp(stored).metadata()).format).toBe('png');
    const vector = await storage.get(asset.vectorStorageKey!);
    expect(vector.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(vector).digest('hex')).toBe(asset.vectorSha256);

    // Certificates from a template on that background are drawn on the vector page, not the PNG.
    const document = { ...createDefaultDocument(), backgroundAssetId: asset.id };
    const template = await owner.request('POST', `/api/organizations/${orgA}/templates`, { name: '向量背景模板', document });
    expect(template.statusCode, template.body).toBe(200);
    const version = await owner.request('POST', `/api/organizations/${orgA}/templates/${template.json().id}/publish`);
    expect(version.statusCode, version.body).toBe(200);
    const manifest = (await db.templateVersion.findUniqueOrThrow({ where: { id: version.json().id } })).assetManifest;
    expect(manifest).toMatchObject({ background: { id: asset.id, sha256: asset.sha256, vectorSha256: asset.vectorSha256 } });
    const onVector = await owner.request('POST', `/api/organizations/${orgA}/batches`, {
      templateVersionId: version.json().id,
      eventName: '向量背景',
      csv: `recipient_name,recipient_email,certificate_number\n向量,${email('pdf-vector')},${sn('vector')}`,
      idempotencyKey: randomUUID(),
    });
    expect(onVector.statusCode, onVector.body).toBe(200);
    const vectorRow = await db.batchRow.findFirstOrThrow({ where: { batchId: onVector.json().id } });
    const rendered = await owner.request('POST', `/api/organizations/${orgA}/batches/${onVector.json().id}/preview`, { rowId: vectorRow.id });
    expect(rendered.statusCode, rendered.body).toBe(200);
    const output = rendered.rawPayload.toString('latin1');
    expect(output).not.toMatch(/\/Subtype\s*\/Image/);

    const broken = await owner.upload(`/api/organizations/${orgA}/assets`, 'broken.pdf', Buffer.from('%PDF-1.7\nnot really a pdf'));
    expect(broken.statusCode).toBe(400);
  });
});
