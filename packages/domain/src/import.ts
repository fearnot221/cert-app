import { parse } from "csv-parse/sync";
import { z } from "zod";
import { collectPlaceholders, type TemplateDocument } from "@cert/contracts";
export type ImportRow = {
  rowNumber: number;
  data: Record<string, string>;
  errors: { field: string; message: string }[];
};
export function validateCsv(csv: string, document: TemplateDocument) {
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
    info: true,
    max_record_size: 8192,
  }) as { record: Record<string, string>; info: { lines: number } }[];
  return validateImportRows(
    records.map(({ record, info }) => ({
      rowNumber: info.lines,
      data: record,
    })),
    document,
  );
}

export function validateImportRows(
  records: { rowNumber: number; data: Record<string, string> }[],
  document: TemplateDocument,
) {
  if (!records.length || records.length > 100)
    throw new Error("每批接受 1 至 100 筆");
  if (new Set(records.map((r) => r.rowNumber)).size !== records.length)
    throw new Error("原始列號不可重複");
  const seen = new Set<string>();
  const system = new Set([
    "organization_name",
    "event_name",
    "certificate_number",
    "issue_date",
  ]);
  const placeholders = collectPlaceholders(document);
  const rows: ImportRow[] = records.map(({ data: record, rowNumber }) => {
    const data = Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, v.trim()]),
    );
    data.recipient_email = data.recipient_email?.toLowerCase() ?? "";
    const errors: ImportRow["errors"] = [];
    const err = (field: string, message: string) =>
      errors.push({ field, message });
    if (!data.recipient_name) err("recipient_name", "姓名必填");
    if (!z.email().safeParse(data.recipient_email).success)
      err("recipient_email", "Email 格式不正確");
    if (data.issue_date && !z.iso.date().safeParse(data.issue_date).success)
      err("issue_date", "日期需為有效 YYYY-MM-DD");
    for (const [key, value] of Object.entries(data)) {
      if (value.length > 500) err(key, "欄位超過 500 字元");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        err(key, "含有不允許的控制字元");
    }
    for (const field of document.fields) {
      if (system.has(field.key)) continue;
      const value = data[field.key];
      if (field.required && !value) err(field.key, "必填欄位缺漏");
      if (!value) continue;
      if (field.type === "email" && !z.email().safeParse(value).success)
        err(field.key, "Email 格式錯誤");
      if (field.type === "number" && !Number.isFinite(Number(value)))
        err(field.key, "數字格式錯誤");
      if (field.type === "date" && !z.iso.date().safeParse(value).success)
        err(field.key, "日期需為有效 YYYY-MM-DD");
    }
    for (const key of placeholders)
      if (!system.has(key) && !data[key] && !errors.some((e) => e.field === key))
        err(key, "缺少模板欄位");
    const signature = JSON.stringify(
      Object.keys(data)
        .sort()
        .map((k) => [k, data[k]]),
    );
    if (seen.has(signature)) err("row", "重複資料");
    seen.add(signature);
    return { rowNumber, data, errors };
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
