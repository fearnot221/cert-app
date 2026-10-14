import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { parse } from "csv-parse/sync";

export interface ImportSheet {
  name: string;
  headers: string[];
  rows: { rowNumber: number; values: string[] }[];
}
// Inspect actual decompressed bytes before allowing the workbook parser to allocate its model.
async function inspectArchive(bytes: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          return reject(new Error("不是有效的 Excel .xlsx 檔案"));
        let size = 0;
        let count = 0;
        let done = false;
        const names = new Set<string>();
        const stop = (err: Error) => {
          if (!done) {
            done = true;
            zip.close();
            reject(err);
          }
        };
        zip.on("error", stop);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve();
          }
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          if (
            ++count > 200 ||
            entry.uncompressedSize > 8 * 1024 * 1024 ||
            names.has(entry.fileName) ||
            /vbaProject|externalLinks/i.test(entry.fileName)
          )
            return stop(new Error("Excel 結構超過限制，或含巨集／外部連結"));
          names.add(entry.fileName);
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return stop(new Error("無法解壓縮 Excel"));
            const chunks: Buffer[] = [];
            stream.on("error", stop);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 20 * 1024 * 1024) {
                stream.destroy();
                stop(new Error("Excel 解壓縮後超過 20 MB"));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("end", () => {
              if (done) return;
              if (
                /^xl\/worksheets\/.*\.xml$/i.test(entry.fileName) &&
                (Buffer.concat(chunks)
                  .toString("utf8")
                  .match(/<c[ >]/g)?.length ?? 0) > 32000
              )
                return stop(new Error("Excel 儲存格數量超過限制"));
              if (
                /\.xml$/i.test(entry.fileName) &&
                /<!DOCTYPE|<!ENTITY/i.test(
                  Buffer.concat(chunks).toString("utf8"),
                )
              )
                return stop(new Error("Excel 不接受自訂 XML 實體"));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
function checkSheet(sheet: ImportSheet) {
  if (
    !sheet.headers.length ||
    sheet.headers.length > 32 ||
    sheet.headers.some((h) => !h.trim() || h.length > 80) ||
    new Set(sheet.headers).size !== sheet.headers.length
  )
    throw new Error(
      `${sheet.name}：第一列須為不重複且非空白的欄位名稱（最多 32 欄）`,
    );
  if (!sheet.rows.length || sheet.rows.length > 100)
    throw new Error(`${sheet.name}：每個工作表接受 1 至 100 筆資料`);
  if (sheet.rows.some((r) => r.values.some((v) => v.length > 500)))
    throw new Error(`${sheet.name}：單一儲存格不可超過 500 字元`);
  return sheet;
}
export async function parseImportFile(
  bytes: Buffer,
  filename: string,
): Promise<ImportSheet[]> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new Error("名單檔案需介於 1 byte 至 2 MB");
  if (/\.csv$/i.test(filename)) {
    if (bytes.length > 512 * 1024) throw new Error("CSV 不可超過 512 KB");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parse(text, {
      bom: true,
      skip_empty_lines: true,
      info: true,
      max_record_size: 32768,
    }) as unknown as { record: string[]; info: { lines: number } }[];
    if (!parsed.length) throw new Error("CSV 沒有資料");
    return [
      checkSheet({
        name: "CSV",
        headers: parsed[0]!.record.map((v) => v.trim()),
        rows: parsed
          .slice(1)
          .map((r) => ({ rowNumber: r.info.lines, values: r.record })),
      }),
    ];
  }
  if (!/\.xlsx$/i.test(filename))
    throw new Error("請使用 .xlsx 或 UTF-8 .csv；舊版 .xls 請先另存為 .xlsx");
  await inspectArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  if (workbook.worksheets.length > 20) throw new Error("最多接受 20 個工作表");
  const sheets: ImportSheet[] = [];
  for (const sheet of workbook.worksheets) {
    if (!sheet.actualRowCount) continue;
    if (sheet.rowCount > 1000 || sheet.columnCount > 32)
      throw new Error(`${sheet.name}：資料範圍過大，請移除多餘空白列／欄`);
    const width = sheet.columnCount;
    const records: ImportSheet["rows"] = [];
    sheet.eachRow((row, rowNumber) => {
      const values: string[] = [];
      for (let index = 1; index <= width; index++) {
        const cell = row.getCell(index);
        const value = cell.value;
        if (cell.isMerged)
          throw new Error(
            `${sheet.name} 第 ${rowNumber} 列：請先取消合併儲存格`,
          );
        if (
          value &&
          typeof value === "object" &&
          ("formula" in value || "sharedFormula" in value || "error" in value)
        )
          throw new Error(
            `${sheet.name} 第 ${rowNumber} 列：公式或錯誤儲存格請先貼上為值`,
          );
        values.push(
          value instanceof Date ? value.toISOString().slice(0, 10) : cell.text,
        );
      }
      if (values.some((v) => v.trim())) records.push({ rowNumber, values });
    });
    if (records[0]?.rowNumber !== 1)
      throw new Error(`${sheet.name}：欄位名稱必須放在第一列`);
    sheets.push(
      checkSheet({
        name: sheet.name,
        headers: records[0]!.values.map((v) => v.trim()),
        rows: records.slice(1),
      }),
    );
  }
  if (!sheets.length) throw new Error("Excel 沒有可匯入的工作表");
  return sheets;
}
