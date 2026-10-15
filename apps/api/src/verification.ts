import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db, storage, certificateStatus, expiryDateSchema, expiryInstant, verifyAccessPassword, ACCESS_LOCK_MS, ACCESS_MAX_FAILURES } from '@cert/domain';
import { normalizeSerial } from '@cert/contracts';
import { authorize, fail } from './auth.js';
export async function registerVerificationRoutes(app: FastifyInstance) {
  const noIndex = (reply: FastifyReply) => reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const serialInput = z.string().max(200).transform(normalizeSerial).pipe(z.string().min(1, '請輸入證書流水號').max(64));
  /** The newest edition of each row that issued this serial; a reissue keeps the serial. */
  async function currentBySerial(serial: string) {
    // Imported serials are stored upper-case; older certificates may not be, so compare upper-cased.
    const ids = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Certificate" WHERE upper("number") = ${serial} LIMIT 200`;
    const all = await db.certificate.findMany({
      where: { id: { in: ids.map((r) => r.id) }, generationStatus: 'success' },
      include: { organization: true },
      orderBy: { edition: 'desc' },
      take: 50,
    });
    const latest = new Map<string, (typeof all)[number]>();
    for (const c of all) if (!latest.has(c.rowId)) latest.set(c.rowId, c);
    return [...latest.values()];
  }
  const publicStatus = (c: Awaited<ReturnType<typeof currentBySerial>>[number]) =>
    !c.organization.active ? 'unavailable' : certificateStatus(c);

  // Confirms a serial exists. Shows who issued it and its state, never who holds it.
  app.get('/api/public/serials', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => req.ip } } }, async (req, reply) => {
    noIndex(reply);
    const { serial } = z.object({ serial: serialInput }).parse(req.query);
    const matches = await currentBySerial(serial);
    if (!matches.length) fail(404, '查無此證書流水號，請確認輸入是否正確');
    return {
      serial,
      checkedAt: new Date().toISOString(),
      matches: matches.map((c) => ({
        organization: c.organization.name,
        eventName: (c.dataSnapshot as Record<string, string>).event_name ?? '',
        issueDate: (c.dataSnapshot as Record<string, string>).issue_date ?? null,
        expiresAt: c.expiresAt,
        status: publicStatus(c),
      })),
    };
  });

  // Serial + password from the notification email downloads the PDF without an account.
  app.post('/api/public/certificates/download', { config: { rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: (req: { ip: string }) => req.ip } } }, async (req, reply) => {
    noIndex(reply);
    const body = z.object({ serial: serialInput, password: z.string().trim().min(1, '請輸入密碼').max(64) }).strict().parse(req.body);
    const now = new Date();
    const candidates = (await currentBySerial(body.serial)).filter((c) => c.accessKeyHash);
    const open = candidates.filter((c) => !c.accessLockedUntil || c.accessLockedUntil <= now);
    if (candidates.length && !open.length) fail(429, '這個流水號嘗試錯誤次數過多，請 15 分鐘後再試');
    let match: (typeof candidates)[number] | undefined;
    for (const c of open) if (await verifyAccessPassword(c.accessKeyHash!, body.password)) { match = c; break; }
    if (!match) {
      for (const c of open) {
        const failures = c.accessFailures + 1;
        const lock = failures >= ACCESS_MAX_FAILURES;
        await db.certificate.update({
          where: { id: c.id },
          data: lock ? { accessFailures: 0, accessLockedUntil: new Date(now.getTime() + ACCESS_LOCK_MS) } : { accessFailures: failures },
        });
      }
      fail(403, '流水號或密碼不正確，請對照通知信再試一次');
    }
    const status = publicStatus(match);
    if (status !== 'valid')
      fail(410, ({ revoked: '這份證書已被發證單位撤銷，無法下載', expired: '這份證書已超過有效期限，無法下載', superseded: '這份證書已由新版取代，請使用最新通知信中的資料' } as Record<string, string>)[status] ?? '目前無法下載這份證書，請聯絡發證單位');
    if (!match.pdfKey) fail(404, '證書檔案尚未準備好');
    if (match.accessFailures) await db.certificate.update({ where: { id: match.id }, data: { accessFailures: 0 } });
    await db.auditLog.create({ data: { organizationId: match.organizationId, action: 'certificate.downloaded_with_password', resourceId: match.id, metadata: { batchId: match.batchId, number: match.number } } });
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="certificate.pdf"; filename*=UTF-8''${encodeURIComponent(match.number)}.pdf`)
      .send(await storage.get(match.pdfKey));
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
