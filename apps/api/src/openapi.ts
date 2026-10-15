import type { SwaggerTransform } from "@fastify/swagger";
import { z } from "zod";
import { TemplateDocumentSchema } from "@cert/contracts";
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const templateSchema = z.toJSONSchema(TemplateDocumentSchema, {
  target: "draft-7",
  io: "input",
});
delete templateSchema.$schema;
const importProperties = {
  templateVersionId: uuid,
  eventName: { type: "string", maxLength: 160 },
  csv: {
    type: "string",
    description:
      "UTF-8 CSV, required headers recipient_name, recipient_email. Maximum 100 rows and 512 KB. Supply csv OR records.",
  },
};
const records = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: object({
    rowNumber: { type: "integer", minimum: 2, maximum: 1000000 },
    data: {
      type: "object",
      maxProperties: 32,
      additionalProperties: { type: "string", maxLength: 500 },
    },
  }),
};
const expiry = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] };
const importBody = { ...importProperties, records, expiresOn: expiry };
const bodies: Record<string, unknown> = {
  "POST /api/organizations/:org/certificates/:id/expiry": object({ expiresOn: expiry, reason: { type: "string", minLength: 1, maxLength: 500 }, revision: { type: "integer", minimum: 1 } }),
  "PUT /api/organizations/:org/batches/:id": object({ revision: { type: "integer", minimum: 1 }, eventName: { type: "string", minLength: 1, maxLength: 160 }, reason: { type: "string", minLength: 1, maxLength: 500 }, records }),
  "POST /api/organizations/:org/batches/:id/cancel": object({ revision: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 1, maxLength: 500 } }),
  "POST /api/organizations/:org/certificates/:id/revoke": object({ reason: { type: "string", minLength: 1, maxLength: 500 } }),
  "POST /api/organizations/:org/certificates/:id/reissue": object({ reason: { type: "string", minLength: 1, maxLength: 500 }, data: records.items.properties.data }, ["reason"]),
  "POST /api/auth/login": object({
    email: { type: "string", format: "email" },
    password: { type: "string", maxLength: 256 },
  }),
  "POST /api/auth/resend-activation": object({
    email: { type: "string", format: "email", maxLength: 254 },
  }),
  "POST /api/auth/forgot-password": object({
    email: { type: "string", format: "email", maxLength: 254 },
  }),
  "POST /api/auth/reset-password": object({
    token: { type: "string", minLength: 32, maxLength: 128 },
    password: { type: "string", minLength: 12, maxLength: 128 },
  }),
  "POST /api/auth/activate": object({
    token: { type: "string", minLength: 32, maxLength: 128 },
    password: { type: "string", minLength: 12, maxLength: 128 },
  }),
  "POST /api/organizations/:org/templates": object({
    name: { type: "string", maxLength: 160 },
    document: templateSchema,
  }),
  "PUT /api/organizations/:org/templates/:id": object({
    name: { type: "string", maxLength: 160 },
    document: templateSchema,
    revision: { type: "integer", minimum: 1 },
  }),
  "POST /api/organizations/:org/batches/validate": object(importBody, [
    "templateVersionId",
    "eventName",
  ]),
  "POST /api/organizations/:org/batches": object(
    {
      ...importBody,
      idempotencyKey: uuid,
    },
    ["templateVersionId", "eventName", "idempotencyKey"],
  ),
  "POST /api/organizations/:org/batches/:id/zip": object(
    {
      certificateIds: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: uuid,
      },
    },
    [],
  ),
  "POST /api/organizations/:org/batches/:id/preview": object({ rowId: uuid }),
  "POST /api/organizations/:org/batches/:id/send": object({
    senderIdentityId: uuid,
  }),
  "POST /api/organizations/:org/batches/:id/deliveries/retry": object({
    senderIdentityId: uuid,
    reason: { ...string, minLength: 1, maxLength: 500 },
  }),
};
/** Documentation-only transform. Runtime validation remains strict Zod + tenant authorization. */
export const apiDocumentation: SwaggerTransform = ({ schema, url, route }) => {
  const method = String(route.method);
  const key = `${method} ${url}`;
  const tag = url.includes("/auth/")
    ? "帳號"
    : url.includes("/templates")
      ? "模板"
      : url.includes("/batches")
        ? "批次"
        : url.includes("/certificates")
          ? "證書"
          : url.includes("/assets")
            ? "資產"
            : "組織";
  const publicRoute =
    /^\/api\/(auth\/(csrf|login|activate|resend-activation|forgot-password|reset-password)|public\/|health|fonts\/|openapi)/.test(
      url,
    );
  const result: typeof schema = {
    ...schema,
    tags: [tag],
    security: publicRoute ? [] : [{ session: [] }],
  };
  if (url.endsWith("/imports/parse"))
    result.description =
      "Multipart file upload: .xlsx up to 2 MB or UTF-8 CSV up to 512 KB. Returns worksheets, headers and original row numbers for mapping. Requires recipients.import. Does not create a batch.";
  if (url.endsWith("/zip"))
    result.description =
      "Requires certificates.download. Downloads successful valid PDFs only, with stored SHA-256 verification. Optional certificateIds must all belong to this batch. 50 MB total limit, no re-rendering.";
  if (url.endsWith("/failures.csv"))
    result.description =
      "Requires recipients.export. UTF-8 BOM CSV for PDF failures and failed/unknown notifications. Quotes fields and neutralizes spreadsheet formula prefixes.";
  if (bodies[key]) result.body = bodies[key];
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    result.headers = object({
      "x-csrf-token": {
        ...string,
        description:
          "Call GET /api/auth/csrf first. Preserve its cookie and pass returned csrfToken here.",
      },
    });
  if (
    method === "GET" &&
    /\/(templates|batches|deliveries|audit|certificates)$/.test(url)
  )
    result.querystring = object(
      {
        ...(url.endsWith("/batches")
          ? {
              search: { type: "string", maxLength: 160 },
              status: {
                type: "string",
                enum: ["validated", "generating", "generated", "failed", "cancelled"],
              },
            }
          : {}),
        take: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        skip: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
      },
      [],
    );
  if (url.includes("/:org"))
    result.description =
      (result.description ?? "") +
      " Requires an active organization Membership and the operation-specific permission. Resource lookup is always scoped to the same organization. The org URL value does not grant access.";
  if (url.endsWith("/send"))
    result.description =
      "Explicitly queues notifications only after every row has successfully generated. Only authorized development Mailpit senders are enabled in Phase 1. SMTP accepted does not mean delivered. Returns { queued, skipped, message }: existing deliveries are never reset, so queued can be 0 with skipped counts (inProgress, accepted, unknown, failed, cancelled) explaining why.";
  if (url.endsWith("/deliveries/retry"))
    result.description =
      "Requires mail.send and certificates.issue plus a reason. Re-queues only failed or cancelled deliveries of this sender whose certificate is currently valid, unexpired and generated; attempts are kept as history and the reason is audited. Unknown deliveries are never retried (check the Message-ID manually). Returns 409 when nothing is retryable, so a double submit queues once.";
  if (url.endsWith("/generate"))
    result.description =
      "Requires a successful server PDF preview. Repeated requests reuse row certificates and durable outbox records.";
  return { schema: result, url };
};
