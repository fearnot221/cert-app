import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, expiryInstant, expiryDateSchema } from '@cert/domain';
import { normalizeSerial } from '@cert/contracts';
import { checkRecords, loadBatchTemplates, recordsInput } from './batch-input.js';
import { authorize, fail } from './auth.js';
const scope = z.object({ org: z.uuid(), id: z.uuid() });
const reason = z.string().trim().min(1).max(500);
const fields = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).refine(k => !['constructor','prototype','__proto__'].includes(k)), z.string().max(500)).refine(d => Object.keys(d).length <= 32);
const json = (v: unknown) => v as Prisma.InputJsonValue;
async function lockedBatch(tx: Prisma.TransactionClient, org: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`;
  const batch = await tx.issuanceBatch.findFirst({ where: { id, organizationId: org }, include: { rows: true, organization: true, certificates: true } });
  if (!batch) fail(404, '找不到活動');
  return batch;
}
async function log(tx: Prisma.TransactionClient, org: string, actor: { id: string; email: string }, action: string, batchId: string, resourceId: string, metadata: unknown) {
  await tx.auditLog.create({ data: { organizationId: org, actorId: actor.id, action, resourceId, metadata: json({ batchId, actorEmail: actor.email, ...metadata as object }) } });
}
async function stopMail(tx: Prisma.TransactionClient, org: string, ids: string[]) {
  const inFlight = await tx.emailDelivery.count({ where: { organizationId: org, certificateId: { in: ids }, status: 'sending' } });
  const stopped = await tx.emailDelivery.updateMany({ where: { organizationId: org, certificateId: { in: ids }, status: 'queued' }, data: { status: 'cancelled', error: '活動取消或證書已失效，停止寄送' } });
  return { queuedCancelled: stopped.count, inFlight };
}
export async function registerLifecycleRoutes(app: FastifyInstance) {
  app.put('/api/organizations/:org/batches/:id', async req => {
    const { org, id } = scope.parse(req.params);
    const { user } = await authorize(req, org, 'recipients.import');
    const body = z.object({ revision: z.number().int().positive(), eventName: z.string().trim().min(1).max(160), expiresOn: expiryDateSchema.optional(), reason, records: recordsInput }).strict().parse(req.body);
    return db.$transaction(async tx => {
      const b = await lockedBatch(tx, org, id);
      if (b.status !== 'validated' || b.certificates.length) fail(409, '已開始產製的活動不可修改；請使用證書重新發放');
      if (b.revision !== body.revision) fail(409, '活動已被更新，請重新載入');
      if (new Set(body.records.map(r => r.rowNumber)).size !== body.records.length) fail(400, "序號不可重複");
      const templates = await loadBatchTemplates(org, [b.templateVersionId, ...b.rows.map(r => r.templateVersionId)], tx);
      const result = await checkRecords(tx, org, templates, { records: body.records }, id);
      if (!result.valid) fail(400, `名單有錯誤：${result.rows.flatMap(r => r.errors.map(e => `第 ${r.rowNumber} 筆 ${e.message}`)).slice(0, 3).join('；')}`);
      await tx.batchRow.deleteMany({ where: { batchId: id, organizationId: org } });
      const updated = await tx.issuanceBatch.update({ where: { id }, data: { expiresAt: body.expiresOn === undefined ? b.expiresAt : expiryInstant(body.expiresOn), eventName: body.eventName, revision: { increment: 1 }, previewedAt: null, rows: { create: result.rows.map(r => ({ rowNumber: r.rowNumber, templateVersionId: r.templateVersionId!, data: json(r.data) })) } } });
      await log(tx, org, user, 'batch.edited', id, id, { reason: body.reason, before: { expiresAt: b.expiresAt?.toISOString() ?? null, eventName: b.eventName, revision: b.revision, records: b.rows.map(r => ({ rowNumber: r.rowNumber, templateVersionId: r.templateVersionId, data: r.data })) }, after: { expiresAt: updated.expiresAt?.toISOString() ?? null, eventName: updated.eventName, revision: updated.revision, records: body.records } });
      return updated;
    });
  });
  app.post('/api/organizations/:org/batches/:id/cancel', async req => {
    const { org, id } = scope.parse(req.params);
    const { user } = await authorize(req, org, 'certificates.revoke');
    const body = z.object({ reason, revision: z.number().int().positive() }).strict().parse(req.body);
    return db.$transaction(async tx => {
      const b = await lockedBatch(tx, org, id);
      if (b.status === 'cancelled') return { ok: true };
      if (b.revision !== body.revision) fail(409, '活動已更新，請重新載入後確認');
      const valid = b.certificates.filter(c => c.status === 'valid');
      const mail = await stopMail(tx, org, valid.map(c => c.id));
      await tx.certificate.updateMany({ where: { organizationId: org, batchId: id, status: 'valid' }, data: { status: 'revoked' } });
      await tx.certificate.updateMany({ where: { organizationId: org, batchId: id, generationStatus: { in: ['pending','generating','failed'] } }, data: { generationStatus: 'cancelled' } });
      await tx.batchRow.updateMany({ where: { organizationId: org, batchId: id, status: { not: 'success' } }, data: { status: 'cancelled', error: null } });
      await tx.issuanceBatch.update({ where: { id }, data: { status: 'cancelled', cancelReason: body.reason, cancelledAt: new Date(), revision: { increment: 1 } } });
      await log(tx, org, user, 'batch.cancelled', id, id, { reason: body.reason, before: { status: b.status }, after: { status: 'cancelled' }, revokedCertificates: valid.map(c => ({ id: c.id, number: c.number })), ...mail });
      return { ok: true, ...mail };
    });
  });
  for (const action of ['revoke','reissue'] as const) {
    app.post(`/api/organizations/:org/certificates/:id/${action}`, async req => {
      const { org, id } = scope.parse(req.params);
      const { user } = await authorize(req, org, 'certificates.revoke');
      if (action === 'reissue') await authorize(req, org, 'certificates.issue');
      const body = z.object({ reason, data: fields.optional(), expiresOn: expiryDateSchema.optional() }).strict().parse(req.body);
      const original = await db.certificate.findFirst({ where: { id, organizationId: org } });
      if (!original) fail(404, '找不到證書');
      return db.$transaction(async tx => {
        const b = await lockedBatch(tx, org, original.batchId);
        if (b.status === 'cancelled') fail(409, '活動已取消，不可再操作證書');
        const c = b.certificates.find(c => c.id === id)!;
        const successor = b.certificates.find(next => next.previousCertificateId === c.id);
        if (successor) fail(409, '此證書已有新版，請重新載入後操作最新版本');
        if (action === 'revoke' && c.status === 'revoked') return { ok: true };
        if (!['valid','revoked'].includes(c.status)) fail(409, '此證書不可操作');
        if (action === 'reissue' && !['success','failed','cancelled'].includes(c.generationStatus)) fail(409, '請等待產製結束再重新發放');
        const mail = await stopMail(tx, org, [c.id]);
        if (action === 'revoke') {
          await tx.certificate.update({ where: { id }, data: { status: 'revoked', ...(c.generationStatus !== 'success' ? { generationStatus: 'cancelled' } : {}) } });
          if (c.generationStatus !== 'success') await tx.batchRow.update({ where: { id: c.rowId }, data: { status: 'cancelled', error: null } });
          const remaining = await tx.batchRow.count({ where: { batchId: b.id, status: { in: ['pending','generating'] } } });
          const failed = await tx.batchRow.count({ where: { batchId: b.id, status: 'failed' } });
          await tx.issuanceBatch.update({ where: { id: b.id }, data: { revision: { increment: 1 }, ...(!remaining ? { status: failed ? 'failed' : 'generated' } : {}) } });
          await log(tx, org, user, 'certificate.revoked', b.id, c.id, { reason: body.reason, number: c.number, before: { status: c.status }, after: { status: 'revoked' }, ...mail });
          return { ok: true };
        }
        const row = b.rows.find(r => r.id === c.rowId)!;
        const data = body.data ?? row.data as Record<string,string>;
        const templates = await loadBatchTemplates(org, [c.templateVersionId], tx);
        // The reissue keeps its serial unless staff change it; another row's serial is still refused.
        const checked = await checkRecords(tx, org, templates, { records: [{ rowNumber: row.rowNumber, templateVersionId: c.templateVersionId, data: { certificate_number: c.number, ...data } }] }, b.id);
        const clean = checked.rows[0]!.data;
        const otherRow = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Certificate" WHERE "organizationId" = ${org} AND upper("number") = ${clean.certificate_number!} AND "rowId" <> ${row.id} LIMIT 1`)[0]
          ?? await tx.batchRow.findFirst({ where: { batchId: b.id, id: { not: row.id }, data: { path: ['certificate_number'], equals: clean.certificate_number! } }, select: { id: true } });
        if (otherRow) fail(409, `流水號 ${clean.certificate_number} 已被其他證書使用`);
        if (checked.rows[0]!.errors.length) fail(400, `請檢查補發資料：${checked.rows[0]!.errors.map(e => e.message).join('；')}`);
        const account = await tx.user.upsert({ where: { email: clean.recipient_email! }, create: { email: clean.recipient_email! }, update: {} });
        const recipient = await tx.recipient.upsert({ where: { organizationId_email: { organizationId: org, email: clean.recipient_email! } }, create: { organizationId: org, userId: account.id, email: account.email, name: clean.recipient_name! }, update: {} });
        const nextId = randomUUID();
        const publicId = randomUUID();
        // Certificates from before serials were imported may differ only in letter case.
        const number = normalizeSerial(c.number) === clean.certificate_number ? c.number : clean.certificate_number!;
        // Same serial and password as before, so the recipient's email still works for the corrected PDF.
        const next = await tx.certificate.create({ data: { id: nextId, publicId, accessKeyHash: number === c.number ? c.accessKeyHash : null, expiresAt: body.expiresOn === undefined ? c.expiresAt : expiryInstant(body.expiresOn), organizationId: org, batchId: b.id, rowId: c.rowId, edition: c.edition + 1, previousCertificateId: c.id, recipientId: recipient.id, templateVersionId: c.templateVersionId, number, dataSnapshot: json({ ...c.dataSnapshot as object, ...clean, organization_name: (c.dataSnapshot as Record<string,string>).organization_name, event_name: (c.dataSnapshot as Record<string,string>).event_name, certificate_number: number }) } });
        await tx.certificate.update({ where: { id: c.id }, data: { status: c.status === 'revoked' ? 'revoked' : 'superseded' } });
        await tx.batchRow.update({ where: { id: row.id }, data: { data: json(clean), status: 'pending', error: null } });
        await tx.issuanceBatch.update({ where: { id: b.id }, data: { status: 'generating', revision: { increment: 1 } } });
        await tx.outboxEvent.create({ data: { organizationId: org, kind: 'pdf', entityId: nextId, dedupeKey: `pdf-${nextId}` } });
        await log(tx, org, user, 'certificate.reissued', b.id, nextId, { reason: body.reason, before: { id: c.id, number: c.number, status: c.status, expiresAt: c.expiresAt?.toISOString() ?? null, data: c.dataSnapshot }, after: { id: nextId, number, status: 'valid', expiresAt: next.expiresAt?.toISOString() ?? null, data: next.dataSnapshot }, ...mail });
        return { ok: true, certificateId: nextId };
      });
    });
  }
  app.get('/api/organizations/:org/batches/:id/history', async req => {
    const { org, id } = scope.parse(req.params);
    await authorize(req, org, 'certificates.generate');
    if (!await db.issuanceBatch.findFirst({ where: { id, organizationId: org } })) fail(404, '找不到活動');
    const certificates = await db.certificate.findMany({ where: { organizationId: org, batchId: id }, select: { id: true } });
    const query = z.object({ skip: z.coerce.number().int().min(0).max(100000).default(0) }).parse(req.query);
    return { items: await db.auditLog.findMany({ where: { organizationId: org, OR: [{ resourceId: { in: [id, ...certificates.map(c => c.id)] } }, { metadata: { path: ['batchId'], equals: id } }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, skip: query.skip }) };
  });
}
