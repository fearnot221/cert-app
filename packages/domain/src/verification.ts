import { z } from 'zod';
export const expiryDateSchema = z.iso.date().nullable();
/** A selected day remains valid through 23:59:59.999 in Taipei. */
export function expiryInstant(date: string | null | undefined) {
  return date ? new Date(`${date}T23:59:59.999+08:00`) : null;
}
export function certificateStatus(c: { status: string; generationStatus: string; expiresAt?: Date | null }, now = new Date()) {
  if (c.status !== 'valid') return c.status;
  if (c.generationStatus !== 'success') return 'pending';
  return c.expiresAt && c.expiresAt <= now ? 'expired' : 'valid';
}
export const unexpiredWhere = () => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });
