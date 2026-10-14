import { z } from "zod";

export const RENDERER_VERSION = "1" as const;
export const FONT_FAMILY = "Noto Sans TC" as const;
export const FONT_SHA256 =
  "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f";
export const FONT_ASSET_VERSION = `noto-sans-tc-${FONT_SHA256.slice(0, 12)}`;

export const IANSUI_SHA256 =
  "7f1aa62e9dcbf40d0ce41a5d3f1e5ea602e66c295778ac6fefb6b84d8ed08bd5";
export const IANSUI_VERSION = `iansui-${IANSUI_SHA256.slice(0, 12)}`;

const safeKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine(
    (value) => !["constructor", "prototype", "__proto__"].includes(value),
    "保留名稱不能作為欄位名稱",
  );
const safeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const finite = z.number().finite();

export const FieldDefinitionSchema = z
  .object({
    key: safeKey,
    label: z.string().min(1).max(80),
    type: z.enum(["text", "email", "date", "number"]),
    required: z.boolean(),
  })
  .strict();
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const TextElementSchema = z
  .object({
    id: safeId,
    type: z.literal("text"),
    x: finite.min(0).max(1000),
    y: finite.min(0).max(1000),
    width: finite.min(1).max(1000),
    height: finite.min(1).max(1000),
    rotation: finite.min(-180).max(180),
    fontFamily: z.enum([FONT_FAMILY, "Iansui"]),
    fontSize: finite.min(6).max(200),
    minFontSize: finite.min(6).max(200),
    fontWeight: z.union([z.literal(400), z.literal(700)]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    align: z.enum(["left", "center", "right"]),
    text: z.string().max(10000),
  })
  .strict()
  .refine(
    (value) => value.fontFamily !== "Iansui" || value.fontWeight === 400,
    { message: "芫荽僅提供標準 400 字重", path: ["fontWeight"] },
  )
  .refine((value) => value.minFontSize <= value.fontSize, {
    message: "最小字級不能大於設定字級",
    path: ["minFontSize"],
  });
export type TextElement = z.infer<typeof TextElementSchema>;

const placeholderPattern = /{{\s*([a-z][a-z0-9_]{0,63})\s*}}/g;

export function extractPlaceholders(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(placeholderPattern)].map((match) => match[1]!),
    ),
  ];
}

export const TemplateDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rendererVersion: z.literal(RENDERER_VERSION),
    widthMm: finite.min(50).max(1000),
    heightMm: finite.min(50).max(1000),
    backgroundAssetId: safeId.optional(),
    /** Retired public-verification QR position. Older versions still carry it; it is never drawn. */
    verificationQr: z.unknown().optional(),
    elements: z.array(TextElementSchema).max(100),
    fields: z.array(FieldDefinitionSchema).max(100),
  })
  .strict()
  .superRefine((document, context) => {
    const fieldKeys = new Set(document.fields.map((field) => field.key));
    const elementIds = new Set(document.elements.map((element) => element.id));
    if (fieldKeys.size !== document.fields.length)
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "欄位名稱不可重複",
      });
    if (elementIds.size !== document.elements.length)
      context.addIssue({
        code: "custom",
        path: ["elements"],
        message: "元素 ID 不可重複",
      });
    document.elements.forEach((element, index) => {
      const remaining = element.text.replace(placeholderPattern, "");
      if (remaining.includes("{{") || remaining.includes("}}")) {
        context.addIssue({
          code: "custom",
          path: ["elements", index, "text"],
          message: "只允許 {{field_name}} 動態欄位，不能使用運算式",
        });
      }
      for (const key of extractPlaceholders(element.text)) {
        if (!fieldKeys.has(key))
          context.addIssue({
            code: "custom",
            path: ["elements", index, "text"],
            message: `未宣告動態欄位：${key}`,
          });
      }
      const angle = (element.rotation * Math.PI) / 180;
      const rotatedWidth =
        Math.abs(element.width * Math.cos(angle)) +
        Math.abs(element.height * Math.sin(angle));
      const rotatedHeight =
        Math.abs(element.width * Math.sin(angle)) +
        Math.abs(element.height * Math.cos(angle));
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      if (
        cx - rotatedWidth / 2 < -0.01 ||
        cy - rotatedHeight / 2 < -0.01 ||
        cx + rotatedWidth / 2 > document.widthMm + 0.01 ||
        cy + rotatedHeight / 2 > document.heightMm + 0.01
      ) {
        context.addIssue({
          code: "custom",
          path: ["elements", index],
          message: "文字框超出紙張範圍",
        });
      }
    });
  });
export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>;
export type CertificateData = Record<string, string | number>;

/**
 * Certificate serial numbers come from the import list, like names and emails. They are compared
 * after NFKC normalisation and upper-casing, so a full-width or lower-case copy finds the same serial.
 */
export const SERIAL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\-_.\/#()]{0,63}$/u;
export function normalizeSerial(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}
export function isValidSerial(value: string) {
  return SERIAL_PATTERN.test(value);
}

export function collectPlaceholders(document: TemplateDocument): string[] {
  return [
    ...new Set(
      document.elements.flatMap((element) => extractPlaceholders(element.text)),
    ),
  ];
}

/** Only replaces named placeholders. Values are never interpreted as HTML or code. */
export function interpolateText(
  text: string,
  data: CertificateData,
  options: { allowMissing?: boolean } = {},
): string {
  return text.replace(
    placeholderPattern,
    (placeholder: string, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        if (options.allowMissing) return placeholder;
        throw new Error(`缺少動態欄位：${key}`);
      }
      const value = data[key];
      if (typeof value !== "string" && typeof value !== "number")
        throw new Error(`不支援的欄位型別：${key}`);
      return String(value);
    },
  );
}

export type DataValidationIssue = { field: string; message: string };

export function validateTemplateData(
  document: TemplateDocument,
  data: CertificateData,
): DataValidationIssue[] {
  const issues: DataValidationIssue[] = [];
  const used = new Set(collectPlaceholders(document));
  for (const field of document.fields) {
    const value = Object.prototype.hasOwnProperty.call(data, field.key)
      ? data[field.key]
      : undefined;
    const text = value === undefined ? "" : String(value).trim();
    if (!text && (field.required || used.has(field.key))) {
      issues.push({ field: field.key, message: `${field.label}為必填` });
      continue;
    }
    if (!text) continue;
    if (text.length > 10000)
      issues.push({
        field: field.key,
        message: `${field.label}超過 10,000 字限制`,
      });
    if (field.type === "email" && !z.email().safeParse(text).success)
      issues.push({
        field: field.key,
        message: `${field.label}不是有效 Email`,
      });
    if (
      field.type === "number" &&
      (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text) || !Number.isFinite(Number(text)))
    )
      issues.push({ field: field.key, message: `${field.label}不是有效數字` });
    if (field.type === "date" && !z.iso.date().safeParse(text).success)
      issues.push({
        field: field.key,
        message: `${field.label}請使用 YYYY-MM-DD 日期`,
      });
  }
  return issues;
}

/**
 * Fields every template carries. Recipient fields come from the import list; system fields are
 * filled in by the platform when a certificate is issued, so they never appear in the import.
 * `certificate_number` is the serial from the list, unique within the organization.
 */
export const BUILTIN_FIELDS: readonly (FieldDefinition & { source: "recipient" | "system"; hint: string })[] = [
  { key: "recipient_name", label: "姓名", type: "text", required: true, source: "recipient", hint: "名單提供" },
  { key: "recipient_email", label: "Email", type: "email", required: true, source: "recipient", hint: "名單提供，用於寄送" },
  { key: "certificate_number", label: "證書流水號", type: "text", required: true, source: "recipient", hint: "名單提供，組織內不可重複" },
  { key: "organization_name", label: "組織名稱", type: "text", required: true, source: "system", hint: "自動帶入" },
  { key: "event_name", label: "活動名稱", type: "text", required: true, source: "system", hint: "取自發證活動" },
  { key: "issue_date", label: "發證日期", type: "date", required: true, source: "system", hint: "未提供則為發證當天" },
];
const builtinKeys = new Set(BUILTIN_FIELDS.map((field) => field.key));
export const isBuiltinField = (key: string) => builtinKeys.has(key);

/**
 * Adds any built-in field a template is missing (older templates predate some of them) and drops the
 * retired verification QR, so saving an older template removes it.
 */
export function withBuiltinFields<T extends TemplateDocument>(document: T): T {
  const { verificationQr: _retired, ...rest } = document;
  const present = new Set(rest.fields.map((field) => field.key));
  const missing = BUILTIN_FIELDS.filter((field) => !present.has(field.key)).map(
    ({ key, label, type, required }) => ({ key, label, type, required }),
  );
  return { ...rest, fields: missing.length ? [...rest.fields, ...missing] : rest.fields } as T;
}

export function createDefaultDocument(): TemplateDocument {
  const text = (
    id: string,
    value: string,
    y: number,
    size: number,
    height: number,
  ): TextElement => ({
    id,
    type: "text",
    x: 28,
    y,
    width: 241,
    height,
    rotation: 0,
    fontFamily: FONT_FAMILY,
    fontSize: size,
    minFontSize: Math.min(size, 12),
    fontWeight: id === "title" || id === "recipient" ? 700 : 400,
    color: "#203C39",
    align: "center",
    text: value,
  });
  return {
    schemaVersion: 1,
    rendererVersion: RENDERER_VERSION,
    widthMm: 297,
    heightMm: 210,
    elements: [
      text("organization", "{{organization_name}}", 28, 16, 14),
      text("title", "結業證書", 50, 34, 25),
      text("recipient", "{{recipient_name}}", 89, 28, 25),
      text("event", "完成 {{event_name}}", 127, 17, 25),
      text("issued", "發證日期 {{issue_date}}", 166, 11, 12),
      {
        ...text("serial", "證書編號 {{certificate_number}}", 190, 9, 8),
        x: 18,
        width: 110,
        minFontSize: 7,
        align: "left",
      },
    ],
    fields: [
      { key: "recipient_name", label: "姓名", type: "text", required: true },
      { key: "recipient_email", label: "Email", type: "email", required: true },
      {
        key: "organization_name",
        label: "組織名稱",
        type: "text",
        required: true,
      },
      { key: "event_name", label: "活動名稱", type: "text", required: true },
      { key: "issue_date", label: "發證日期", type: "date", required: true },
      { key: "certificate_number", label: "證書流水號", type: "text", required: true },
    ],
  };
}
