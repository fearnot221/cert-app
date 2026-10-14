import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, certificateStatus, expiryDateSchema, expiryInstant } from '@cert/domain';
import { authorize, fail } from './auth.js';
export async function registerVerificationRoutes(app: FastifyInstance) {
  app.get('/api/public/certificates/:publicId', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => req.ip } } }, async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const { publicId } = z.object({ publicId: z.uuid() }).parse(req.params);
    const c = await db.certificate.findUnique({ where: { publicId }, include: { organization: true } });
    if (!c || c.generationStatus !== 'success') fail(404, '找不到已發放的證書，請確認驗證連結');
    const successor = await db.certificate.findFirst({ where: { previousCertificateId: c.id }, select: { id: true } });
    const snapshot = c.dataSnapshot as Record<string,string>;
    const name = [...(snapshot.recipient_name ?? '')];
    return { number: c.number, organization: c.organization.name, eventName: snapshot.event_name ?? '', recipientName: name.length ? `${name[0]}${'＊'.repeat(Math.min(Math.max(name.length - 1, 1), 4))}` : '未提供', issuedAt: c.issuedAt, issueDate: snapshot.issue_date ?? null, expiresAt: c.expiresAt, status: !c.organization.active ? 'unavailable' : certificateStatus(c), hasReplacement: !!successor, edition: c.edition, checkedAt: new Date().toISOString() };
  });
  app.post('/api/organizations/:org/certificates/:id/expiry', async req => {
    const { org, id } = z.object({ org: z.uuid(), id: z.uuid() }).parse(req.params);
    const { user } = await authorize(req, org, 'certificates.issue');
    await authorize(req, org, 'certificates.revoke');
    const body = z.object({ expiresOn: expiryDateSchema, revision: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    const original = await db.certificate.findFirst({ where: { id, organizationId: org } });
    if (!original) fail(404, '找不到證書');
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "IssuanceBatch" WHERE id=${original.batchId} FOR UPDATE`;
      const c = await tx.certificate.findUniqueOrThrow({ where: { id }, include: { batch: true } });
      if (c.status !== 'valid' || c.batch.status === 'cancelled') fail(409, '失效或已取消的證書不可調整期限，請重新發放');
      if (c.revision !== body.revision) fail(409, '證書期限已更新，請重新載入');
      const expiresAt = expiryInstant(body.expiresOn);
      const updated = await tx.certificate.update({ where: { id }, data: { expiresAt, revision: { increment: 1 } } });
      const cancelled = expiresAt && expiresAt <= new Date() ? await tx.emailDelivery.updateMany({ where: { certificateId: id, status: 'queued' }, data: { status: 'cancelled', error: '證書已到期，停止寄送' } }) : { count: 0 };
      await tx.issuanceBatch.update({ where: { id: c.batchId }, data: { revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: org, actorId: user.id, action: 'certificate.expiry_changed', resourceId: id, metadata: { batchId: c.batchId, actorEmail: user.email, reason: body.reason, before: { expiresAt: c.expiresAt?.toISOString() ?? null, status: certificateStatus(c) }, after: { expiresAt: expiresAt?.toISOString() ?? null, status: certificateStatus(updated) }, queuedCancelled: cancelled.count } } });
      return { ok: true, expiresAt, revision: updated.revision };
    });
  });
}
