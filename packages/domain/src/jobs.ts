import { createHash } from "node:crypto";
import { emailProvider } from "./email.js";
import { Pool } from "pg";
import { renderVersionPdf } from "./rendering.js";
import { config } from "@cert/config";
import { db } from "./db.js";
import { certificateStatus } from "./verification.js";
import { generateAccessPassword, hashAccessPassword } from "./access.js";
import { storage } from "./storage.js";
const jobLocks = new Pool({ connectionString: config.DATABASE_URL, max: 8 });
export async function closeJobResources() {
  await jobLocks.end();
}
export async function withJobLock(key: string, run: () => Promise<void>) {
  const client = await jobLocks.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      key,
    ]);
    await run();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
      key,
    ]);
    client.release();
  }
}
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function classifyMailError(error: {
  responseCode?: number;
  code?: string;
}): "permanent" | "temporary" | "unknown" {
  return error.responseCode && error.responseCode >= 500
    ? "permanent"
    : error.responseCode && error.responseCode >= 400
      ? "temporary"
      : "unknown";
}
async function finishBatch(batchId: string, organizationId: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${batchId} FOR UPDATE`;
    const batch = await tx.issuanceBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status === "cancelled") return;
    const remaining = await tx.batchRow.count({ where: { batchId, organizationId, status: { in: ["pending", "generating"] } } });
    if (remaining) return;
    const failed = await tx.batchRow.count({ where: { batchId, organizationId, status: "failed" } });
    await tx.issuanceBatch.update({ where: { id: batchId }, data: { status: failed ? "failed" : "generated" } });
  });
}
export async function processPdf(
  certificateId: string,
  organizationId: string,
) {
  return withJobLock(`pdf:${certificateId}`, () =>
    processPdfLocked(certificateId, organizationId),
  );
}
async function processPdfLocked(certificateId: string, organizationId: string) {
  const c = await db.certificate.findFirst({
    where: { id: certificateId, organizationId },
    include: { templateVersion: true, organization: true },
  });
  if (!c) throw new Error("Certificate scope mismatch");
  if (c.status !== "valid") return;
  if (c.generationStatus === "success") {
    await finishBatch(c.batchId, organizationId);
    return;
  }
  try {
    if (!c.organization.active) throw new Error("組織已停用");
    const claimed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${c.batchId} FOR UPDATE`;
      const current = await tx.certificate.findUniqueOrThrow({ where: { id: c.id }, include: { batch: true } });
      if (current.status !== "valid" || current.batch.status === "cancelled") return false;
      await tx.certificate.update({ where: { id: c.id }, data: { generationStatus: "generating" } });
      await tx.batchRow.update({ where: { id: c.rowId }, data: { status: "generating", error: null } });
      return true;
    });
    if (!claimed) return;
    const pdf = await renderVersionPdf(
      c.templateVersion,
      organizationId,
      c.dataSnapshot as Record<string, string>,
    );
    const pdfKey = `${organizationId}/certificates/${c.id}.pdf`;
    await storage.put(pdfKey, pdf);
    if (
      !(await db.organization.findUnique({ where: { id: organizationId } }))
        ?.active
    )
      throw new Error("組織已停用");
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${c.batchId} FOR UPDATE`;
      const current = await tx.certificate.findUniqueOrThrow({ where: { id: c.id }, include: { batch: true } });
      if (current.status !== "valid" || current.batch.status === "cancelled") return;
      await tx.certificate.update({ where: { id: c.id }, data: { generationStatus: "success", pdfKey, pdfSha256: hash(pdf) } });
      await tx.batchRow.update({ where: { id: c.rowId }, data: { status: "success", error: null } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "產製失敗";
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${c.batchId} FOR UPDATE`;
      const current = await tx.certificate.findUniqueOrThrow({
        where: { id: c.id },
      });
      if (current.generationStatus === "success" || current.status !== "valid") return;
      await tx.certificate.update({
        where: { id: c.id },
        data: { generationStatus: "failed" },
      });
      await tx.batchRow.update({
        where: { id: c.rowId },
        data: { status: "failed", error: message.slice(0, 500) },
      });
    });
  }
  await finishBatch(c.batchId, organizationId);
}
export async function processMail(
  deliveryId: string,
  organizationId: string,
  attemptNumber = 1,
) {
  return withJobLock(`mail:${deliveryId}`, () =>
    processMailLocked(deliveryId, organizationId, attemptNumber),
  );
}
async function processMailLocked(
  deliveryId: string,
  organizationId: string,
  attemptNumber: number,
) {
  const delivery = await db.emailDelivery.findFirst({
    where: { id: deliveryId, organizationId },
    include: {
      organization: true,
      senderIdentity: { include: { grant: { include: { connection: true } } } },
      certificate: true,
    },
  });
  if (!delivery) throw new Error("Delivery scope mismatch");
  if (["accepted", "unknown", "failed", "cancelled"].includes(delivery.status)) return;
  if (delivery.status === "sending") {
    // A previous worker may have handed the message to SMTP before it died.
    await db.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "unknown",
        error:
          "工作中斷；SMTP 結果不確定，請以 Message-ID 人工查核，系統不會自動重寄",
      },
    });
    await db.deliveryAttempt.updateMany({
      where: { deliveryId: delivery.id, status: "sending" },
      data: {
        status: "unknown",
        errorClass: "interrupted",
        endedAt: new Date(),
      },
    });
    return;
  }
  const sender = delivery.senderIdentity;
  if (
    config.MAIL_MODE !== "mailpit" ||
    !delivery.organization.active ||
    !sender.active ||
    sender.status !== "development" ||
    !sender.grant.active ||
    !sender.grant.connection.active ||
    sender.grant.connection.provider !== "mailpit" ||
    delivery.certificate.generationStatus !== "success" ||
    certificateStatus(delivery.certificate) !== "valid"
  ) {
    await db.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", error: "組織、證書或寄件授權已停用" },
    });
    return;
  }
  if (
    /[\r\n]/.test(sender.fromAddress + sender.displayName + delivery.toAddress)
  )
    throw new Error("Invalid mail header");
  const attempt = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${delivery.certificate.batchId} FOR UPDATE`;
    const current = await tx.certificate.findUniqueOrThrow({ where: { id: delivery.certificateId }, include: { batch: true } });
    if (certificateStatus(current) !== "valid" || current.batch.status === "cancelled") {
      await tx.emailDelivery.updateMany({ where: { id: delivery.id, status: "queued" }, data: { status: "cancelled", error: "證書已失效或到期" } });
      return null;
    }
    const claimed = await tx.emailDelivery.updateMany({ where: { id: delivery.id, status: "queued" }, data: { status: "sending" } });
    if (claimed.count !== 1) return null;
    return tx.deliveryAttempt.create({ data: { organizationId, deliveryId: delivery.id, status: "sending" } });
  });
  if (!attempt) return;
  // A fresh password for every notification. Only its hash is stored, and only once SMTP accepts the
  // message, so a failed send never invalidates the password from an earlier email.
  const password = generateAccessPassword();
  const passwordHash = await hashAccessPassword(password);
  const data = delivery.certificate.dataSnapshot as Record<string, string>;
  const serial = delivery.certificate.number;
  const link = `${new URL(config.APP_ORIGIN).origin}/download?serial=${encodeURIComponent(serial)}`;
  const text = `${data.recipient_name} 您好：\n\n您的證書已完成。請開啟下方連結，輸入證書流水號與密碼下載 PDF，不需要註冊帳號。\n\n組織：${delivery.organization.name}\n活動：${data.event_name}\n證書流水號：${serial}\n下載密碼：${password}\n\n${link}\n\n密碼只在這封信中提供，請妥善保存；若之後收到新的通知信，請改用新信中的密碼。如未預期收到此信，請聯絡發證單位。`;
  try {
    // This adapter is only for the local Mailpit sink. Phase3 production SMTP requires TLS and verified identities.
    const result = await emailProvider.send({
      from: { name: sender.displayName, address: sender.fromAddress },
      to: delivery.toAddress,
      subject: `${delivery.organization.name}｜證書下載通知`,
      messageId: delivery.messageId,
      text,
      html: `<div lang="zh-Hant">${text
        .split("\n")
        .map((line) =>
          line.startsWith("http")
            ? `<p><a href="${escape(line)}">前往下載證書</a></p>`
            : `<p>${escape(line)}</p>`,
        )
        .join("")}</div>`,
    });
    if (!result.accepted?.length)
      throw Object.assign(new Error("SMTP recipient rejected"), {
        responseCode: 550,
      });
    await db.$transaction([
      db.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: "accepted", acceptedAt: new Date(), error: null },
      }),
      db.certificate.update({
        where: { id: delivery.certificateId },
        data: { accessKeyHash: passwordHash, accessFailures: 0, accessLockedUntil: null },
      }),
      db.deliveryAttempt.update({
        where: { id: attempt.id },
        data: { status: "accepted", smtpCode: 250, endedAt: new Date() },
      }),
    ]);
  } catch (error) {
    const code = classifyMailError(error as { responseCode?: number });
    const currentCertificate = await db.certificate.findUniqueOrThrow({ where: { id: delivery.certificateId } });
    const retry = code === "temporary" && attemptNumber < 3 && currentCertificate.status === "valid";
    await db.$transaction([
      db.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: retry ? "queued" : code === "unknown" ? "unknown" : "failed",
          error:
            code === "unknown"
              ? "SMTP 結果不確定，請人工查核 Message-ID"
              : code === "temporary"
                ? "SMTP 暫時性拒絕"
                : "SMTP 永久性拒絕",
        },
      }),
      db.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: retry ? "retry" : code === "unknown" ? "unknown" : "failed",
          errorClass: code,
          smtpCode: (error as { responseCode?: number }).responseCode,
          endedAt: new Date(),
        },
      }),
    ]);
    if (retry) throw new Error("Temporary SMTP rejection");
  }
}
export async function processOutbox(id: string, attemptNumber = 1) {
  const event = await db.outboxEvent.findUnique({ where: { id } });
  if (!event || event.completedAt) return;
  if (event.kind === "pdf")
    await processPdf(event.entityId, event.organizationId);
  else if (event.kind === "mail")
    await processMail(event.entityId, event.organizationId, attemptNumber);
  else throw new Error("Unsupported outbox event");
  await db.outboxEvent.update({
    where: { id: event.id },
    data: { completedAt: new Date() },
  });
}
