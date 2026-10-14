import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { parseImportFile } from "../../packages/domain/src/spreadsheet-import";
import {
  encodeCsv,
  validateImportRows,
} from "../../packages/domain/src/import";
import { createDefaultDocument } from "@cert/contracts";

async function workbookBytes(edit?: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("培訓名單");
  sheet.addRow(["姓名", "電子郵件", "發證日期", "學員編號"]);
  sheet.addRow([
    "王小明",
    "person@example.test",
    new Date("2026-10-15T00:00:00Z"),
    "00123",
  ]);
  sheet.addRow([]);
  sheet.addRow([
    "陳怡君",
    "second@example.test",
    new Date("2026-10-16T00:00:00Z"),
    "00009",
  ]);
  edit?.(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}
describe("Excel/CSV source parsing and safe reports", () => {
  it("preserves Chinese headers, worksheet names, text IDs, dates and original row numbers", async () => {
    const sheets = await parseImportFile(
      await workbookBytes((book) => {
        const sheet = book.addWorksheet("第二梯次");
        sheet.addRow(["姓名", "Email"]);
        sheet.addRow(["林同學", "third@example.test"]);
      }),
      "名單.xlsx",
    );
    expect(sheets.map((s) => s.name)).toEqual(["培訓名單", "第二梯次"]);
    expect(sheets[0]!.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(sheets[0]!.rows[0]!.values).toEqual([
      "王小明",
      "person@example.test",
      "2026-10-15",
      "00123",
    ]);
  });
  it("reads 1904 date-system files without date drift", async () => {
    const sheets = await parseImportFile(
      await workbookBytes((book) => {
        book.properties.date1904 = true;
      }),
      "dates.xlsx",
    );
    expect(sheets[0]!.rows[0]!.values[2]).toBe("2026-10-15");
  });
  it("rejects formulas, merges and duplicate headers instead of silently losing values", async () => {
    await expect(
      parseImportFile(
        await workbookBytes((b) => {
          b.worksheets[0]!.getCell("A2").value = { formula: "1+1", result: 2 };
        }),
        "formula.xlsx",
      ),
    ).rejects.toThrow("公式");
    await expect(
      parseImportFile(
        await workbookBytes((b) => {
          b.worksheets[0]!.mergeCells("A2:A3");
        }),
        "merge.xlsx",
      ),
    ).rejects.toThrow("合併");
    await expect(
      parseImportFile(
        await workbookBytes((b) => {
          b.worksheets[0]!.getCell("B1").value = "姓名";
        }),
        "duplicate.xlsx",
      ),
    ).rejects.toThrow("不重複");
  });
  it("rejects oversized compression, invalid containers, legacy formats and more than 100 recipients", async () => {
    const archive = Buffer.from(
      zipSync({
        "xl/worksheets/sheet1.xml": strToU8("a".repeat(9 * 1024 * 1024)),
      }),
    );
    await expect(parseImportFile(archive, "bomb.xlsx")).rejects.toThrow("限制");
    await expect(
      parseImportFile(Buffer.from("not-excel"), "fake.xlsx"),
    ).rejects.toThrow("有效");
    await expect(
      parseImportFile(Buffer.from("legacy"), "old.xls"),
    ).rejects.toThrow("另存");
    await expect(
      parseImportFile(
        await workbookBytes((b) => {
          for (let i = 0; i < 100; i++)
            b.worksheets[0]!.addRow(["新增", `u${i}@example.test`]);
        }),
        "large.xlsx",
      ),
    ).rejects.toThrow("100");
  });
  it("parses UTF-8 CSV with Chinese headers and rejects malformed encoding", async () => {
    const [sheet] = await parseImportFile(
      Buffer.from(
        "\uFEFF姓名,Email\n王小明,a@example.test\n\n陳怡君,b@example.test",
      ),
      "名單.csv",
    );
    expect(sheet!.headers).toEqual(["姓名", "Email"]);
    expect(sheet!.rows[1]!.rowNumber).toBe(4);
    await expect(
      parseImportFile(Buffer.from([0xff, 0xff]), "bad.csv"),
    ).rejects.toThrow();
  });
  it("validates mapped/manual records again and makes report formulas inert while preserving quotes/newlines", () => {
    const result = validateImportRows(
      [
        {
          rowNumber: 8,
          data: { recipient_name: "王小明", recipient_email: "wrong" },
        },
      ],
      createDefaultDocument(),
    );
    expect(result.valid).toBe(false);
    expect(result.rows[0]!.rowNumber).toBe(8);
    expect(() =>
      validateImportRows(
        [
          { rowNumber: 2, data: {} },
          { rowNumber: 2, data: {} },
        ],
        createDefaultDocument(),
      ),
    ).toThrow("列號");
    const csv = encodeCsv([
      ["姓名", "錯誤"],
      [' =HYPERLINK("bad")', "第一行\n第二行"],
    ]);
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"');
    expect(csv).toContain('"第一行\n第二行"');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});
