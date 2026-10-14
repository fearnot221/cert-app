import { parse } from "csv-parse/sync";
import { z } from "zod";
import { collectPlaceholders, isValidSerial, normalizeSerial, type TemplateDocument } from "@cert/contracts";
export type ImportRow = {
  /** 1 for the first data row, whatever line of the file it came from. */
  rowNumber: number;
  data: Record<string, string>;
  /** The template this recipient's certificate uses; null only when the row names no usable template. */
  templateVersionId: string | null;
  errors: { field: string; message: string }[];
};
export type BatchTemplate = { id: string; name: string; document: TemplateDocument };
export type ImportRecord = {
  rowNumber: number;
  data: Record<string, string>;
  templateVersionId?: string;
};
/** The list column that picks a template, by the template's name, when an event uses several. */
export const TEMPLATE_COLUMN = "template";
const templateKey = (name: string) => name.normalize("NFKC").trim().toLowerCase();

export function validateCsv(csv: string, templates: BatchTemplate[]) {
  if (Buffer.byteLength(csv) > 512 * 1024) throw new Error("CSV 超過 512 KB");
  const records = parse(csv, {
    bom: true,
    columns: (headers: string[]) => {
      if (
        new Set(headers).size !== headers.length ||
        headers.some(
          (h) =>
            !/^[_a-zA-Z][_a-zA-Z0-9]{0,63}$/.test(h) ||
            ["__proto__", "constructor", "prototype"].includes(h),
        )
      )
        throw new Error("CSV 欄位名稱無效或重複");
      return headers;
    },
    skip_empty_lines: true,
    max_record_size: 8192,
  }) as Record<string, string>[];
  return validateBatchRows(
    records.map((data, index) => ({ rowNumber: index + 1, data })),
    templates,
  );
}

/** Single-template form, kept for callers that validate against one document. */
export function validateImportRows(records: ImportRecord[], document: TemplateDocument) {
  return validateBatchRows(records, [{ id: "", name: "", document }]);
}

export function validateBatchRows(records: ImportRecord[], templates: BatchTemplate[]) {
  if (!records.length || records.length > 100)
    throw new Error("每批接受 1 至 100 筆");
  if (!templates.length) throw new Error("請至少選擇一個模板");
  if (new Set(records.map((r) => r.rowNumber)).size !== records.length)
    throw new Error("序號不可重複");
  const byName = new Map(templates.map((t) => [templateKey(t.name), t]));
  if (templates.length > 1 && byName.size !== templates.length)
    throw new Error("選擇的模板名稱重複，請先把模板改成不同名稱");
  const seen = new Set<string>();
  const serials = new Map<string, number>();
  const system = new Set(["organization_name", "event_name", "issue_date"]);
  const rows: ImportRow[] = records.map(({ data: record, rowNumber, templateVersionId }) => {
    const data = Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, v.trim()]),
    );
    const errors: ImportRow["errors"] = [];
    const err = (field: string, message: string) =>
      errors.push({ field, message });
    const templateName = data[TEMPLATE_COLUMN] ?? "";
    delete data[TEMPLATE_COLUMN];
    let template: BatchTemplate | undefined;
    if (templateVersionId) {
      template = templates.find((t) => t.id === templateVersionId);
      if (!template) err(TEMPLATE_COLUMN, "這個模板不在本活動選用的模板中");
    } else if (templateName) {
      template = byName.get(templateKey(templateName));
      if (!template)
        err(TEMPLATE_COLUMN, `找不到模板「${templateName}」，可用：${templates.map((t) => t.name).join("、")}`);
    } else if (templates.length === 1) template = templates[0];
    else err(TEMPLATE_COLUMN, "活動使用多個模板，請填寫模板名稱");
    data.recipient_email = data.recipient_email?.toLowerCase() ?? "";
    data.certificate_number = normalizeSerial(data.certificate_number ?? "");
    if (!data.recipient_name) err("recipient_name", "姓名必填");
    if (!z.email().safeParse(data.recipient_email).success)
      err("recipient_email", "Email 格式不正確");
    if (!data.certificate_number) err("certificate_number", "證書流水號必填");
    else if (!isValidSerial(data.certificate_number))
      err("certificate_number", "流水號只能使用文字、數字與 - _ . / # ( )，最多 64 字");
    else if (serials.has(data.certificate_number))
      err("certificate_number", `與第 ${serials.get(data.certificate_number)} 筆的流水號重複`);
    else serials.set(data.certificate_number, rowNumber);
    if (data.issue_date && !z.iso.date().safeParse(data.issue_date).success)
      err("issue_date", "日期需為有效 YYYY-MM-DD");
    for (const [key, value] of Object.entries(data)) {
      if (value.length > 500) err(key, "欄位超過 500 字元");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        err(key, "含有不允許的控制字元");
    }
    const document = template?.document;
    for (const field of document?.fields ?? []) {
      if (system.has(field.key)) continue;
      const value = data[field.key];
      if (field.required && !value && !errors.some((e) => e.field === field.key))
        err(field.key, "必填欄位缺漏");
      if (!value) continue;
      if (field.type === "email" && !z.email().safeParse(value).success)
        err(field.key, "Email 格式錯誤");
      if (field.type === "number" && !Number.isFinite(Number(value)))
        err(field.key, "數字格式錯誤");
      if (field.type === "date" && !z.iso.date().safeParse(value).success)
        err(field.key, "日期需為有效 YYYY-MM-DD");
    }
    for (const key of document ? collectPlaceholders(document) : [])
      if (!system.has(key) && !data[key] && !errors.some((e) => e.field === key))
        err(key, "缺少模板欄位");
    const signature = JSON.stringify(
      Object.keys(data)
        .sort()
        .map((k) => [k, data[k]]),
    );
    if (seen.has(signature)) err("row", "重複資料");
    seen.add(signature);
    return { rowNumber, data, templateVersionId: template?.id || null, errors };
  });
  return { rows, valid: rows.every((r) => !r.errors.length) };
}
export const csvCell = (value: string) =>
  /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;

export function encodeCsv(rows: (string | number)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => `"${csvCell(String(value)).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
