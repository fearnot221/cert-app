import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, validateCsv, validateBatchRows, type BatchTemplate } from "@cert/domain";
import { TemplateDocumentSchema } from "@cert/contracts";
import { fail } from "./auth.js";

const recordInput = z
  .object({
    rowNumber: z.number().int().min(1).max(1000000),
    templateVersionId: z.uuid().optional(),
    data: z
      .record(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]{0,63}$/)
          .refine(
            (k) =>
              !["constructor", "prototype", "__proto__"].includes(k),
          ),
        z.string().max(500),
      )
      .refine((d) => Object.keys(d).length <= 32),
  })
  .strict();
export const recordsInput = z.array(recordInput).min(1).max(100);
/** Published template versions of this organization, with the template names lists refer to. */
export async function loadBatchTemplates(org: string, ids: string[], client: Prisma.TransactionClient = db) {
  const unique = [...new Set(ids)];
  if (!unique.length) fail(400, "請至少選擇一個模板");
  const versions = await client.templateVersion.findMany({
    where: { id: { in: unique }, organizationId: org },
    include: { template: { select: { id: true, name: true } } },
  });
  if (versions.length !== unique.length) fail(404, "找不到已發布模板版本");
  if (new Set(versions.map((v) => v.templateId)).size !== versions.length)
    fail(400, "同一個模板只能選擇一個版本");
  const ordered = unique.map((id) => versions.find((v) => v.id === id)!);
  return ordered.map((v) => ({
    id: v.id,
    name: v.template.name,
    number: v.number,
    document: TemplateDocumentSchema.parse(v.document),
  }));
}

/** Serials already on a certificate, or on a row of another event that is not cancelled. */
export async function takenSerials(
  client: Prisma.TransactionClient,
  org: string,
  serials: string[],
  ownBatchId?: string,
) {
  if (!serials.length) return new Set<string>();
  const certificates = await client.certificate.findMany({
    where: { organizationId: org, number: { in: serials }, ...(ownBatchId ? { batchId: { not: ownBatchId } } : {}) },
    select: { number: true },
  });
  const rows = await client.$queryRaw<{ serial: string }[]>`
    SELECT r.data->>'certificate_number' AS serial FROM "BatchRow" r
    JOIN "IssuanceBatch" b ON b.id = r."batchId"
    WHERE r."organizationId" = ${org} AND b.status <> 'cancelled'
      AND r."batchId" <> ${ownBatchId ?? ""}
      AND r.data->>'certificate_number' = ANY(${serials})`;
  return new Set([...certificates.map((c) => c.number), ...rows.map((r) => r.serial)]);
}

/** Validates a list against its templates and marks serials that another certificate already uses. */
export async function checkRecords(
  client: Prisma.TransactionClient,
  org: string,
  templates: BatchTemplate[],
  input: { csv?: string; records?: z.infer<typeof recordsInput> },
  ownBatchId?: string,
) {
  let result: ReturnType<typeof validateBatchRows>;
  try {
    result = input.records ? validateBatchRows(input.records, templates) : validateCsv(input.csv!, templates);
  } catch (error) {
    fail(400, error instanceof Error ? error.message : "CSV 格式錯誤");
  }
  const taken = await takenSerials(
    client,
    org,
    result.rows.map((r) => r.data.certificate_number!).filter(Boolean),
    ownBatchId,
  );
  for (const row of result.rows)
    if (taken.has(row.data.certificate_number!))
      row.errors.push({ field: "certificate_number", message: "這個流水號已被其他證書或活動使用" });
  return { rows: result.rows, valid: result.rows.every((r) => !r.errors.length) };
}
