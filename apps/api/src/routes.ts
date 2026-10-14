import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import sharp, { type Metadata } from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import {
  db,
  storage,
  encodeCsv, certificateStatus, expiryDateSchema, expiryInstant, unexpiredWhere,
} from "@cert/domain";
import {
  TemplateDocumentSchema,
  FONT_SHA256,
  IANSUI_SHA256,
  IANSUI_VERSION,
  FONT_ASSET_VERSION,
  RENDERER_VERSION,
  withBuiltinFields,
  OrganizationSlugSchema,
  type TemplateDocument,
} from "@cert/contracts";
import { DEFAULT_FONT_PATH, IANSUI_FONT_PATH } from "@cert/renderer/server";
import { authorize, userFor, fail, audit } from "./auth.js";
import { config } from "@cert/config";
import { renderVersionPdf } from "../../../packages/domain/src/rendering.js";
import { parseImportFile } from "../../../packages/domain/src/spreadsheet-import.js";
import { convertPdfBackground, isPdf } from "../../../packages/domain/src/pdf-background.js";
import { registerVerificationRoutes } from "./verification.js";
import { checkRecords, loadBatchTemplates, recordsInput } from "./batch-input.js";
import { registerLifecycleRoutes } from "./lifecycle.js";
import { zipSync } from "fflate";
const json = (value: unknown) => value as Prisma.InputJsonValue;
const params = (req: FastifyRequest) =>
  z
    .object({ org: z.string().uuid(), id: z.string().uuid().optional() })
    .parse(req.params);
const paging = (req: FastifyRequest) =>
  z
    .object({
      take: z.coerce.number().int().min(1).max(100).default(50),
      skip: z.coerce.number().int().min(0).max(100000).default(0),
    })
    .parse(req.query);
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function checkAsset(org: string, document: TemplateDocument) {
  if (
    document.backgroundAssetId &&
    !(await db.asset.findFirst({
      where: { id: document.backgroundAssetId, organizationId: org },
    }))
  )
    fail(400, "背景素材不屬於目前組織");
}
async function getBatch(org: string, id: string, client: Prisma.TransactionClient = db) {
  const b = await client.issuanceBatch.findFirst({
    where: { id, organizationId: org },
    include: {
      templateVersion: true,
      organization: true,
      rows: {
        orderBy: { rowNumber: "asc" },
        include: {
          certificates: { orderBy: { edition: "desc" } },
          templateVersion: { include: { template: { select: { name: true } } } },
        },
      },
    },
  });
  if (!b) fail(404, "找不到發證批次");
  return { ...b, rows: b.rows.map(r => ({ ...r, certificate: r.certificates[0] ?? null })) };
}
const batchInput = z
  .object({
    /** Templates this event may use; each recipient picks one by name in the `template` column. */
    templateVersionIds: z.array(z.uuid()).min(1).max(10).optional(),
    /** Single-template shorthand. */
    templateVersionId: z.uuid().optional(),
    eventName: z.string().trim().min(1).max(160),
    expiresOn: expiryDateSchema.optional(),
    csv: z
      .string()
      .min(1)
      .max(512 * 1024)
      .optional(),
    records: recordsInput.optional(),
  })
  .strict();

async function validateBatch(org: string, body: z.infer<typeof batchInput>, client: Prisma.TransactionClient = db) {
  if (!!body.csv === !!body.records) fail(400, "請提供一種名單來源");
  const templates = await loadBatchTemplates(
    org,
    body.templateVersionIds ?? (body.templateVersionId ? [body.templateVersionId] : []),
    client,
  );
  return { templates, ...(await checkRecords(client, org, templates, body)) };
}
export async function registerRoutes(app: FastifyInstance) {
  await registerLifecycleRoutes(app);
  await registerVerificationRoutes(app);
  let activePreviews = 0;
  let activeImports = 0;
  let activeArchives = 0;
  app.get("/api/health", async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unhealthy" });
    }
  });
  app.get("/api/fonts/iansui", async (_req, reply) =>
    reply.type("font/ttf").send(await readFile(IANSUI_FONT_PATH)),
  );
  app.get("/api/fonts/noto-sans-tc", async (_req, reply) =>
    reply.type("font/ttf").send(await readFile(DEFAULT_FONT_PATH)),
  );
  const organizationSettings = (o: { id: string; name: string; slug: string }) => ({ id: o.id, name: o.name, slug: o.slug });
  app.get("/api/organizations/:org/settings", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "templates.read");
    return organizationSettings(await db.organization.findUniqueOrThrow({ where: { id: org } }));
  });
  app.put("/api/organizations/:org/settings", async (req) => {
    const { org } = params(req);
    const { user } = await authorize(req, org, "organization.manage");
    const body = z
      .object({ slug: OrganizationSlugSchema })
      .strict()
      .parse(req.body);
    return db.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: org } });
      if (before.slug === body.slug) return organizationSettings(before);
      if (await tx.organization.findUnique({ where: { slug: body.slug } }))
        fail(409, "這個網址代稱已被其他組織使用");
      const after = await tx.organization.update({ where: { id: org }, data: { slug: body.slug } });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: user.id,
          action: "organization.slug_updated",
          resourceId: org,
          metadata: { actorEmail: user.email, before: { slug: before.slug }, after: { slug: after.slug } },
        },
      });
      return organizationSettings(after);
    });
  });
  app.get("/api/organizations/:org/templates", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "templates.read");
    return {
      items: await db.template.findMany({
        where: { organizationId: org },
        include: {
          versions: {
            select: { id: true, number: true, document: true },
            orderBy: { number: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
        ...paging(req),
      }),
    };
  });
  app.get("/api/organizations/:org/templates/:id", async (req) => {
    const { org, id } = params(req);
    await authorize(req, org, "templates.read");
    const template = await db.template.findFirst({
      where: { id, organizationId: org },
      include: {
        versions: {
          select: { id: true, number: true, document: true },
          orderBy: { number: "desc" },
        },
      },
    });
    if (!template) fail(404, "找不到模板");
    return template;
  });
  app.post("/api/organizations/:org/templates", async (req) => {
    const { org } = params(req);
    const { user } = await authorize(req, org, "templates.write");
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        document: TemplateDocumentSchema.transform(withBuiltinFields),
      })
      .strict()
      .parse(req.body);
    await checkAsset(org, body.document);
    const t = await db.template.create({
      data: {
        organizationId: org,
        name: body.name,
        document: json(body.document),
      },
      include: { versions: true },
    });
    await audit(org, user.id, "template.created", t.id);
    return t;
  });
  app.put("/api/organizations/:org/templates/:id", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "templates.write");
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        document: TemplateDocumentSchema.transform(withBuiltinFields),
        revision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    await checkAsset(org, body.document);
    const result = await db.template.updateMany({
      where: { id, organizationId: org, revision: body.revision },
      data: {
        name: body.name,
        document: json(body.document),
        revision: { increment: 1 },
        status: "draft",
      },
    });
    if (!result.count) fail(409, "模板已由其他編輯者更新，請重新載入後再編輯");
    await audit(org, user.id, "template.updated", id);
    return db.template.findFirst({
      where: { id, organizationId: org },
      include: {
        versions: {
          select: { id: true, number: true },
          orderBy: { number: "desc" },
        },
      },
    });
  });
  app.post("/api/organizations/:org/templates/:id/publish", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "templates.publish");
    const version = await db.$transaction(async (tx) => {
      // Serialize publication and optimistic draft edits with a row lock.
      await tx.$queryRaw`SELECT id FROM "Template" WHERE id=${id!} AND "organizationId"=${org} FOR UPDATE`;
      const t = await tx.template.findFirst({
        where: { id, organizationId: org },
        include: { versions: { orderBy: { number: "desc" }, take: 1 } },
      });
      if (!t) fail(404, "找不到模板");
      if (t.status === "published" && t.versions[0]) return t.versions[0];
      const document = TemplateDocumentSchema.parse(t.document);
      await checkAsset(org, document);
      const asset = document.backgroundAssetId
        ? await tx.asset.findFirst({
            where: { id: document.backgroundAssetId, organizationId: org },
          })
        : null;
      const v = await tx.templateVersion.create({
        data: {
          organizationId: org,
          templateId: t.id,
          number: (t.versions[0]?.number ?? 0) + 1,
          document: json(document),
          rendererVersion: RENDERER_VERSION,
          assetManifest: {
            font: { version: FONT_ASSET_VERSION, sha256: FONT_SHA256 },
            ...(document.elements.some((e) => e.fontFamily === "Iansui")
              ? { iansui: { version: IANSUI_VERSION, sha256: IANSUI_SHA256 } }
              : {}),
            background: asset
              ? {
                  id: asset.id,
                  sha256: asset.sha256,
                  ...(asset.vectorSha256 ? { vectorSha256: asset.vectorSha256 } : {}),
                }
              : null,
          },
        },
      });
      await tx.template.update({
        where: { id: t.id },
        data: { status: "published" },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: user.id,
          action: "template.published",
          resourceId: v.id,
        },
      });
      return v;
    });
    return version;
  });
  app.post("/api/organizations/:org/assets", async (req) => {
    const { org } = params(req);
    const { user } = await authorize(req, org, "templates.write");
    const file = await req.file();
    if (!file) fail(400, "請選擇圖片或 PDF");
    let bytes = await file.toBuffer();
    let pdfPages = 0;
    let vector: Buffer | undefined;
    if (isPdf(bytes)) {
      try {
        const page = await convertPdfBackground(bytes);
        bytes = page.png;
        vector = page.pdf;
        pdfPages = page.pages;
      } catch (error) {
        req.log.warn({ err: error }, "PDF background rasterisation failed");
        fail(400, "無法讀取這個 PDF，請確認檔案未加密且未損毀");
      }
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
    } catch {
      fail(400, "圖片內容無效或超過 4,000 萬像素");
    }
    if (
      !["png", "jpeg", "webp"].includes(metadata.format || "") ||
      (metadata.pages && metadata.pages > 1)
    )
      fail(400, "只接受 PDF 或靜態 PNG、JPG、WebP");
    // Decode and re-encode to remove metadata and trailing untrusted content.
    const safe = await sharp(bytes, { limitInputPixels: 40000000 })
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const id = randomUUID();
    const storageKey = `${org}/assets/${id}.png`;
    await storage.put(storageKey, safe.data);
    const vectorStorageKey = vector ? `${org}/assets/${id}.pdf` : undefined;
    if (vector) await storage.put(vectorStorageKey!, vector);
    const asset = await db.asset.create({
      data: {
        id,
        organizationId: org,
        filename: pdfPages ? "background-from-pdf.png" : "background.png",
        mimeType: "image/png",
        storageKey,
        sha256: sha(safe.data),
        width: safe.info.width,
        height: safe.info.height,
        size: safe.data.length,
        ...(vector ? { vectorStorageKey, vectorSha256: sha(vector) } : {}),
      },
    });
    await audit(org, user.id, "asset.uploaded", id);
    return {
      id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      ...(pdfPages ? { source: "pdf", pdfPages } : {}),
    };
  });
  app.get("/api/organizations/:org/assets/:id/file", async (req, reply) => {
    const { org, id } = params(req);
    await authorize(req, org, "templates.read");
    const a = await db.asset.findFirst({ where: { id, organizationId: org } });
    if (!a) fail(404, "找不到素材");
    return reply.type(a.mimeType).send(await storage.get(a.storageKey));
  });
  app.post("/api/organizations/:org/imports/parse", async (req, reply) => {
    const { org } = params(req);
    await authorize(req, org, "recipients.import");
    if (activeImports >= 1) fail(429, "另一份名單正在讀取，請稍後再試");
    activeImports++;
    try {
      const file = await req.file({
        limits: { fileSize: 2 * 1024 * 1024, files: 1 },
      });
      if (!file) fail(400, "請選擇名單檔案");
      const bytes = await file.toBuffer();
      const sheets = await parseImportFile(bytes, file.filename);
      return reply.header("Cache-Control", "no-store").send({ sheets });
    } catch (error) {
      fail(400, error instanceof Error ? error.message : "無法讀取名單");
    } finally {
      activeImports--;
    }
  });
  app.post("/api/organizations/:org/batches/validate", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "recipients.import");
    const body = batchInput.parse(req.body);
    const { rows, valid, templates } = await validateBatch(org, body);
    return { rows, valid, templates: templates.map(({ id, name, number }) => ({ id, name, number })) };
  });
  app.post("/api/organizations/:org/batches", async (req) => {
    const { org } = params(req);
    const { user } = await authorize(req, org, "recipients.import");
    const body = batchInput
      .extend({ idempotencyKey: z.uuid() })
      .parse(req.body);
    const existing = await db.issuanceBatch.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: org,
          idempotencyKey: body.idempotencyKey,
        },
      },
    });
    if (existing) return existing;
    const { idempotencyKey: _key, ...input } = body;
    return db.$transaction(async tx => {
    // One issuer at a time per organization, so two lists cannot both claim a serial.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
    const { rows, valid, templates } = await validateBatch(org, batchInput.parse(input), tx);
    if (!valid) fail(400, "請先修正所有錯誤列；本階段不會靜默略過");
    const batch = await tx.issuanceBatch.create({
      data: {
        organizationId: org,
        templateVersionId: templates[0]!.id,
        eventName: body.eventName,
        expiresAt: expiryInstant(body.expiresOn),
        idempotencyKey: body.idempotencyKey,
        rows: {
          create: rows.map((r) => ({
            rowNumber: r.rowNumber,
            templateVersionId: r.templateVersionId!,
            data: json(r.data),
          })),
        },
      },
    });
    await tx.auditLog.create({ data: { organizationId: org, actorId: user.id, action: "batch.created", resourceId: batch.id, metadata: { actorEmail: user.email, eventName: batch.eventName, rowCount: rows.length, templateVersionIds: templates.map((t) => t.id) } } });
    return batch;
    });
  });
  app.get("/api/organizations/:org/batches", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "certificates.generate");
    return {
      items: await db.issuanceBatch.findMany({
        where: {
          organizationId: org,
          ...(() => {
            const q = z
              .object({
                search: z.string().max(160).optional(),
                status: z
                  .enum(["validated", "generating", "generated", "failed", "cancelled"])
                  .optional(),
              })
              .parse(req.query);
            return {
              ...(q.search
                ? {
                    eventName: {
                      contains: q.search,
                      mode: "insensitive" as const,
                    },
                  }
                : {}),
              ...(q.status ? { status: q.status } : {}),
            };
          })(),
        },
        orderBy: { createdAt: "desc" },
        ...paging(req),
        include: { _count: { select: { rows: true } } },
      }),
    };
  });
  app.get("/api/organizations/:org/batches/:id", async (req) => {
    const { org, id } = params(req);
    await authorize(req, org, "certificates.generate");
    const b = await getBatch(org, id!);
    const deliveries = await db.emailDelivery.findMany({
      where: { organizationId: org, certificate: { batchId: id } },
      select: {
        id: true,
        status: true,
        error: true,
        certificateId: true,
        messageId: true,
      },
    });
    return {
      id: b.id,
      expiresAt: b.expiresAt,
      revision: b.revision,
      cancelReason: b.cancelReason,
      cancelledAt: b.cancelledAt,
      eventName: b.eventName,
      status: b.status,
      previewedAt: b.previewedAt,
      templateVersionId: b.templateVersionId,
      templates: [...new Map(b.rows.map((r) => [r.templateVersionId, { id: r.templateVersionId, name: r.templateVersion.template.name, number: r.templateVersion.number }])).values()],
      createdAt: b.createdAt,
      rows: b.rows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        templateVersionId: r.templateVersionId,
        templateName: r.templateVersion.template.name,
        data: r.data,
        status: r.status,
        error: r.error,
        history: r.certificates.map(c => ({ id: c.id, number: c.number, status: c.status, edition: c.edition, previousCertificateId: c.previousCertificateId, issuedAt: c.issuedAt })),
        certificate: r.certificate
          ? {
              id: r.certificate.id,
              number: r.certificate.number,
              status: certificateStatus(r.certificate),
              storedStatus: r.certificate.status,
              expiresAt: r.certificate.expiresAt,
              revision: r.certificate.revision,
              edition: r.certificate.edition,
              passwordSent: !!r.certificate.accessKeyHash,
            }
          : null,
      })),
      deliveries,
    };
  });
  app.post("/api/organizations/:org/batches/:id/zip", async (req, reply) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "certificates.download");
    const { certificateIds } = z
      .object({ certificateIds: z.array(z.uuid()).min(1).max(100).optional() })
      .strict()
      .parse(req.body ?? {});
    const batch = await getBatch(org, id!);
    const eligible = batch.rows.flatMap((row) =>
      row.certificate?.generationStatus === "success" &&
      certificateStatus(row.certificate) === "valid" &&
      row.certificate.pdfKey
        ? [{ row, certificate: row.certificate }]
        : [],
    );
    const selected = certificateIds
      ? eligible.filter((item) => certificateIds.includes(item.certificate.id))
      : eligible;
    if (certificateIds && new Set(certificateIds).size !== selected.length)
      fail(400, "選取項目包含未完成、已撤銷或不屬於此活動的證書");
    if (!selected.length) fail(400, "此活動尚無可下載的成功證書");
    if (activeArchives >= 1) fail(429, "正在準備另一份 ZIP，請稍後再試");
    activeArchives++;
    try {
      const files: Record<string, Uint8Array> = Object.create(null);
      let size = 0;
      for (const { row, certificate } of selected) {
        const bytes = await storage.get(
          certificate.pdfKey!,
          50 * 1024 * 1024 - size,
        );
        size += bytes.length;
        if (size > 50 * 1024 * 1024)
          fail(413, "本次 ZIP 超過 50 MB，請減少勾選數量後下載");
        if (sha(bytes) !== certificate.pdfSha256)
          fail(409, "證書檔案完整性檢查失敗，請聯絡管理員");
        const name = String(
          (row.data as Record<string, string>).recipient_name ?? "recipient",
        )
          .normalize("NFKC")
          .replace(/[\\/<>:"|?*\u0000-\u001f.]/g, "_")
          .slice(0, 60);
        const serial = certificate.number.replace(/[\\/<>:"|?*\u0000-\u001f]/g, "_");
        files[`${serial}-${name}.pdf`] = bytes;
      }
      // Store already compressed PDFs; no duplicate rendering, and no filesystem extraction paths.
      const zip = Buffer.from(zipSync(files, { level: 0 }));
      await audit(org, user.id, "batch.zip_downloaded", id);
      return reply
        .type("application/zip")
        .header("Cache-Control", "no-store")
        .header(
          "Content-Disposition",
          `attachment; filename="certificates-${id}.zip"`,
        )
        .send(zip);
    } finally {
      activeArchives--;
    }
  });
  app.get(
    "/api/organizations/:org/batches/:id/failures.csv",
    async (req, reply) => {
      const { org, id } = params(req);
      const { user } = await authorize(req, org, "recipients.export");
      const batch = await getBatch(org, id!);
      const deliveries = await db.emailDelivery.findMany({
        where: {
          organizationId: org,
          certificate: { batchId: id },
          status: { in: ["failed", "unknown"] },
        },
      });
      const report: (string | number)[][] = [
        ["序號", "姓名", "Email", "階段", "狀態", "錯誤原因", "證書流水號"],
      ];
      for (const row of batch.rows) {
        const data = row.data as Record<string, string>;
        const append = (stage: string, status: string, error: string, certificate = row.certificate) =>
          report.push([
            row.rowNumber,
            (certificate?.dataSnapshot as Record<string,string> | undefined)?.recipient_name ?? data.recipient_name ?? "",
            (certificate?.dataSnapshot as Record<string,string> | undefined)?.recipient_email ?? data.recipient_email ?? "",
            stage,
            status,
            error,
            certificate?.number ?? "",
          ]);
        if (row.status === "failed")
          append("PDF 產製", row.status, row.error ?? "產製失敗");
        for (const delivery of deliveries.filter(
          (d) => row.certificates.some(c => c.id === d.certificateId),
        ))
          append(
            "通知",
            delivery.status,
            delivery.error ?? "請查閱郵件紀錄確認寄送狀態",
            row.certificates.find(c => c.id === delivery.certificateId),
          );
      }
      await audit(org, user.id, "batch.failure_report_downloaded", id);
      return reply
        .type("text/csv; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header(
          "Content-Disposition",
          `attachment; filename="failures-${id}.csv"`,
        )
        .send(encodeCsv(report));
    },
  );
  app.post(
    "/api/organizations/:org/batches/:id/preview",
    async (req, reply) => {
      const { org, id } = params(req);
      await authorize(req, org, "certificates.generate");
      const { rowId } = z.object({ rowId: z.uuid() }).parse(req.body);
      const b = await getBatch(org, id!);
      if (b.status === "cancelled") fail(409, "活動已取消");
      const row = b.rows.find((r) => r.id === rowId);
      if (!row) fail(404, "找不到該批次收件人");
      const data = {
        ...(row.data as Record<string, string>),
        organization_name: b.organization.name,
        event_name: b.eventName,
        issue_date:
          (row.data as Record<string, string>).issue_date ||
          new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Asia/Taipei",
          }).format(new Date()),
      };
      if (activePreviews >= 2) fail(429, "PDF 預覽忙碌，請稍後重試");
      activePreviews++;
      let pdf: Awaited<ReturnType<typeof renderVersionPdf>>;
      try {
        pdf = await renderVersionPdf(row.templateVersion, org, data);
      } catch (error) {
        // Only rendering failures map to 422; business conflicts below keep their own status.
        fail(422, error instanceof Error ? error.message : "PDF 預覽失敗");
      } finally {
        activePreviews--;
      }
      const updated = await db.issuanceBatch.updateMany({
        where: { id: b.id, revision: b.revision, status: { not: "cancelled" } },
        data: { previewedAt: new Date() },
      });
      if (!updated.count) fail(409, "活動已變更，請重新預覽");
      return reply.type("application/pdf").send(pdf);
    },
  );
  app.post("/api/organizations/:org/batches/:id/generate", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "certificates.generate");
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${id!} AND "organizationId"=${org} FOR UPDATE`;
      const b = await getBatch(org, id!, tx);
      if (b.status === "cancelled") fail(409, "活動已取消");
      if (!b.previewedAt) fail(409, "請先預覽伺服器產出的 PDF 樣張");
      for (const row of b.rows) {
        const data = row.data as Record<string, string>;
        const number = data.certificate_number;
        if (!number) fail(409, `第 ${row.rowNumber} 筆缺少證書流水號，請先編輯活動補上`);
        const account = await tx.user.upsert({
          where: { email: data.recipient_email! },
          create: { email: data.recipient_email! },
          update: {},
        });
        const recipient = await tx.recipient.upsert({
          where: {
            organizationId_email: {
              organizationId: org,
              email: data.recipient_email!,
            },
          },
          create: {
            organizationId: org,
            userId: account.id,
            email: account.email,
            name: data.recipient_name!,
          },
          update: {},
        });
        // Generating again (e.g. after a retry) keeps the certificate and its serial number.
        const existing = await tx.certificate.findUnique({
          where: { rowId_edition: { rowId: row.id, edition: 1 } },
        });
        if (!existing && await tx.certificate.findFirst({ where: { organizationId: org, number, rowId: { not: row.id } }, select: { id: true } }))
          fail(409, `流水號 ${number} 已被其他證書使用，請先編輯活動更正`);
        const certId = randomUUID();
        const publicId = randomUUID();
        const cert = existing ?? await tx.certificate.create({
          data: {
            id: certId,
            publicId,
            expiresAt: b.expiresAt,
            organizationId: org,
            batchId: b.id,
            rowId: row.id,
            recipientId: recipient.id,
            templateVersionId: row.templateVersionId,
            number,
            dataSnapshot: {
              ...data,
              organization_name: b.organization.name,
              event_name: b.eventName,
              issue_date:
                data.issue_date ||
                new Intl.DateTimeFormat("sv-SE", {
                  timeZone: "Asia/Taipei",
                }).format(new Date()),
              certificate_number: number,
            },
          },
        });
        if (cert.generationStatus === "pending" && cert.status === "valid")
          await tx.outboxEvent.upsert({
            where: { dedupeKey: `pdf-${cert.id}` },
            create: {
              organizationId: org,
              kind: "pdf",
              entityId: cert.id,
              dedupeKey: `pdf-${cert.id}`,
            },
            update: {},
          });
      }
      const current = await tx.issuanceBatch.findUniqueOrThrow({
        where: { id: b.id },
      });
      if (current.status === "validated")
        await tx.issuanceBatch.update({
          where: { id: b.id },
          data: { status: "generating" },
        });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: user.id,
          action: "batch.generate_requested",
          resourceId: b.id,
        },
      });
    });
    return { ok: true };
  });
  app.post("/api/organizations/:org/batches/:id/retry", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "certificates.generate");
    await getBatch(org, id!);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${id!} AND "organizationId"=${org} FOR UPDATE`;
      const currentBatch = await getBatch(org, id!, tx);
      if (currentBatch.status === "cancelled") fail(409, "活動已取消");
      const failed = await tx.certificate.findMany({
        where: { organizationId: org, batchId: id, generationStatus: "failed", status: "valid" },
      });
      for (const c of failed) {
        await tx.certificate.update({
          where: { id: c.id },
          data: { generationStatus: "pending" },
        });
        await tx.batchRow.update({
          where: { id: c.rowId },
          data: { status: "pending", error: null },
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: org,
            kind: "pdf",
            entityId: c.id,
            dedupeKey: `retry-${c.id}-${randomUUID()}`,
          },
        });
      }
      if (failed.length)
        await tx.issuanceBatch.update({
          where: { id },
          data: { status: "generating" },
        });
      await tx.auditLog.create({ data: { organizationId: org, actorId: user.id, action: "batch.retry_failed", resourceId: id, metadata: { actorEmail: user.email, certificateIds: failed.map(c => c.id) } } });
    });
    return { ok: true };
  });
  app.get("/api/organizations/:org/senders", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "mail.send");
    return {
      items: await db.senderIdentity.findMany({
        where: {
          organizationId: org,
          active: true,
          grant: { active: true, connection: { active: true } },
        },
        select: {
          id: true,
          displayName: true,
          fromAddress: true,
          status: true,
        },
      }),
    };
  });
  app.post("/api/organizations/:org/batches/:id/send", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "mail.send");
    await authorize(req, org, "certificates.issue");
    if (config.MAIL_MODE !== "mailpit") fail(409, "寄信尚未啟用");
    const body = z
      .object({ senderIdentityId: z.uuid() })
      .strict()
      .parse(req.body);
    const sender = await db.senderIdentity.findFirst({
      where: {
        id: body.senderIdentityId,
        organizationId: org,
        active: true,
        status: "development",
        grant: {
          active: true,
          connection: { active: true, provider: "mailpit" },
        },
      },
    });
    if (!sender) fail(403, "寄件身分未授權或已停用");
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${id!} AND "organizationId"=${org} FOR UPDATE`;
      const b = await getBatch(org, id!, tx);
      if (b.status === "cancelled") fail(409, "活動已取消");
      const eligible = b.rows.filter(r => r.certificate?.status === "valid" && (!r.certificate.expiresAt || r.certificate.expiresAt > new Date()));
      if (eligible.some(r => r.status !== "success")) fail(409, "有效證書產製成功後才能發送");
      if (!eligible.length) fail(409, "沒有可寄送的有效證書");
      const queued: string[] = [];
      const skipped = emptyDeliveryCounts();
      for (const row of eligible) {
        const c = row.certificate!;
        const data = c.dataSnapshot as Record<string, string>;
        const deliveryId = randomUUID();
        const delivery = await tx.emailDelivery.upsert({
          where: {
            certificateId_senderIdentityId: {
              certificateId: c.id,
              senderIdentityId: sender.id,
            },
          },
          create: {
            id: deliveryId,
            organizationId: org,
            certificateId: c.id,
            senderIdentityId: sender.id,
            toAddress: data.recipient_email!,
            messageId: `<${deliveryId}@cert.local>`,
          },
          update: {},
        });
        // An existing delivery is never reset here: failed/cancelled ones need the explicit
        // retry action, and unknown ones need a human to check the Message-ID first.
        if (delivery.id !== deliveryId) {
          skipped[deliveryCountKey(delivery.status)]++;
          continue;
        }
        queued.push(delivery.id);
        await tx.outboxEvent.upsert({
          where: { dedupeKey: `mail-${delivery.id}` },
          create: {
            organizationId: org,
            kind: "mail",
            entityId: delivery.id,
            dedupeKey: `mail-${delivery.id}`,
          },
          update: {},
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: user.id,
          action: "batch.mail_requested",
          resourceId: b.id,
          metadata: { actorEmail: user.email, senderIdentityId: sender.id, count: eligible.length, queued: queued.length, skipped, certificateIds: eligible.map(r => r.certificate!.id) },
        },
      });
      return {
        ok: true,
        queued: queued.length,
        skipped,
        message: queued.length
          ? `已排入 ${queued.length} 封通知`
          : deliverySkipMessage(skipped),
      };
    });
  });
  app.post("/api/organizations/:org/batches/:id/deliveries/retry", async (req) => {
    const { org, id } = params(req);
    const { user } = await authorize(req, org, "mail.send");
    await authorize(req, org, "certificates.issue");
    if (config.MAIL_MODE !== "mailpit") fail(409, "寄信尚未啟用");
    const body = z
      .object({ senderIdentityId: z.uuid(), reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    const sender = await db.senderIdentity.findFirst({
      where: {
        id: body.senderIdentityId,
        organizationId: org,
        active: true,
        status: "development",
        grant: {
          active: true,
          connection: { active: true, provider: "mailpit" },
        },
      },
    });
    if (!sender) fail(403, "寄件身分未授權或已停用");
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${id!} AND "organizationId"=${org} FOR UPDATE`;
      const b = await getBatch(org, id!, tx);
      if (b.status === "cancelled") fail(409, "活動已取消");
      const now = new Date();
      const eligible = new Set(
        b.rows
          .filter(r => r.status === "success" && r.certificate?.status === "valid" && r.certificate.generationStatus === "success" && (!r.certificate.expiresAt || r.certificate.expiresAt > now))
          .map(r => r.certificate!.id),
      );
      const deliveries = await tx.emailDelivery.findMany({
        where: { organizationId: org, senderIdentityId: sender.id, certificate: { batchId: b.id } },
        orderBy: { createdAt: "asc" },
      });
      const retryable = deliveries.filter(d => retryableDeliveryStatuses.includes(d.status) && eligible.has(d.certificateId));
      const skipped = emptyDeliveryCounts();
      for (const d of deliveries)
        if (!retryable.includes(d)) skipped[eligible.has(d.certificateId) ? deliveryCountKey(d.status) : "ineligible"]++;
      if (!retryable.length) fail(409, `沒有可重試的通知：${deliverySkipMessage(skipped)}`);
      for (const d of retryable) {
        // Attempts stay as history; only the delivery is moved back to queued with a fresh outbox event.
        const reset = await tx.emailDelivery.updateMany({
          where: { id: d.id, status: d.status },
          data: { status: "queued", error: null },
        });
        if (reset.count !== 1) fail(409, "通知狀態已變更，請重新整理");
        await tx.outboxEvent.create({
          data: {
            organizationId: org,
            kind: "mail",
            entityId: d.id,
            dedupeKey: `mail-retry-${d.id}-${randomUUID()}`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: user.id,
          action: "batch.mail_retry_requested",
          resourceId: b.id,
          metadata: {
            actorEmail: user.email,
            reason: body.reason,
            senderIdentityId: sender.id,
            deliveries: retryable.map(d => ({ id: d.id, certificateId: d.certificateId, before: { status: d.status, error: d.error }, after: { status: "queued" } })),
            skipped,
          },
        },
      });
      return {
        ok: true,
        queued: retryable.length,
        skipped,
        message: `已重新排入 ${retryable.length} 封通知`,
      };
    });
  });
  app.get("/api/organizations/:org/deliveries", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "mail.send");
    return {
      items: await db.emailDelivery.findMany({
        where: { organizationId: org },
        orderBy: { createdAt: "desc" },
        ...paging(req),
        include: {
          senderIdentity: { select: { displayName: true, fromAddress: true } },
          attempts: {
            select: {
              status: true,
              errorClass: true,
              smtpCode: true,
              startedAt: true,
              endedAt: true,
            },
          },
        },
      }),
    };
  });
  app.get("/api/organizations/:org/audit", async (req) => {
    const { org } = params(req);
    await authorize(req, org, "audit.read");
    const items = await db.auditLog.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: "desc" },
      ...paging(req),
    });
    // Show who acted by email rather than by account ID.
    const actorIds = [...new Set(items.flatMap((item) => (item.actorId ? [item.actorId] : [])))];
    const actors = new Map(
      (await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map(
        (user) => [user.id, user.email],
      ),
    );
    return {
      items: items.map((item) => ({
        ...item,
        actor: item.actorId && actors.has(item.actorId) ? { email: actors.get(item.actorId)! } : null,
      })),
    };
  });
  app.get(
    "/api/organizations/:org/certificates/:id/pdf",
    async (req, reply) => {
      const { org, id } = params(req);
      const { user } = await authorize(req, org, "certificates.download");
      const c = await db.certificate.findFirst({
        where: { id, organizationId: org, generationStatus: "success", status: "valid", ...unexpiredWhere() },
      });
      if (!c?.pdfKey) fail(404, "找不到證書");
      await audit(org, user.id, "certificate.downloaded", id);
      return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${c.number}.pdf"`)
        .send(await storage.get(c.pdfKey));
    },
  );
  app.get("/api/me/certificates", async (req) => {
    const user = await userFor(req);
    return {
      items: (await db.certificate.findMany({
        where: {
          recipient: { userId: user.id },
          organization: { active: true },
          generationStatus: "success",
        },
        select: {
          id: true,
          number: true,
          status: true,
          issuedAt: true,
          expiresAt: true, generationStatus: true,
          organization: { select: { name: true } },
          batch: { select: { eventName: true } },
        },
        orderBy: { issuedAt: "desc" },
        ...paging(req),
      })).map(c => ({ ...c, status: certificateStatus(c) })),
    };
  });
  app.get("/api/me/certificates/:id/pdf", async (req, reply) => {
    const user = await userFor(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const c = await db.certificate.findFirst({
      where: {
        id,
        status: "valid",
        ...unexpiredWhere(),
        recipient: { userId: user.id },
        organization: { active: true },
        generationStatus: "success",
      },
    });
    if (!c?.pdfKey) fail(404, "找不到證書");
    await audit(c.organizationId, user.id, "recipient.downloaded", id);
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${c.number}.pdf"`)
      .send(await storage.get(c.pdfKey));
  });
}

const retryableDeliveryStatuses = ["failed", "cancelled"];
function emptyDeliveryCounts() {
  return { inProgress: 0, accepted: 0, unknown: 0, failed: 0, cancelled: 0, ineligible: 0 };
}
type DeliveryCounts = ReturnType<typeof emptyDeliveryCounts>;
function deliveryCountKey(status: string): keyof DeliveryCounts {
  if (status === "accepted" || status === "unknown" || status === "failed" || status === "cancelled") return status;
  return "inProgress";
}
function deliverySkipMessage(skipped: DeliveryCounts) {
  const parts = [
    skipped.inProgress && `${skipped.inProgress} 封仍在排程或傳送中`,
    skipped.accepted && `${skipped.accepted} 封已交付 SMTP`,
    skipped.unknown && `${skipped.unknown} 封結果不確定，請先以 Message-ID 人工核對`,
    (skipped.failed || skipped.cancelled) && `${skipped.failed + skipped.cancelled} 封先前失敗或取消，請使用「重試失敗通知」`,
    skipped.ineligible && `${skipped.ineligible} 封所屬證書目前無效或已到期`,
  ].filter(Boolean);
  return parts.length ? `未排入新通知：${parts.join("；")}` : "未排入新通知";
}
