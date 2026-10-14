import { request } from "./api";
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadFile(
  path: string,
  filename: string,
  body?: unknown,
) {
  const response = await request(
    path,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
  saveBlob(await response.blob(), filename);
}
export function csvBlob(rows: (string | number)[][]) {
  const safe = (value: string | number) => {
    let text = String(value);
    if (/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return new Blob(
    ["\uFEFF" + rows.map((row) => row.map(safe).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
}
