import type { Prisma } from "@prisma/client";
import { formatCertificateNumber } from "@cert/contracts";

/**
 * Hands out the organization's next certificate serial number. The increment is a single row update
 * inside the caller's transaction: concurrent issuers queue on the organization row, and a rolled-back
 * transaction gives its number back, so serials stay unique and gap-free.
 */
export async function allocateCertificateNumber(tx: Prisma.TransactionClient, organizationId: string) {
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { certificateSequence: { increment: 1 } },
    select: { certificatePrefix: true, certificateDigits: true, certificateSequence: true },
  });
  return formatCertificateNumber(org.certificatePrefix, org.certificateDigits, org.certificateSequence);
}
