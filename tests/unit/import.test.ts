import { describe, it, expect } from "vitest";
import { createDefaultDocument } from "@cert/contracts";
import { validateCsv, validateBatchRows, csvCell } from "../../packages/domain/src/import.js";

const single = [{ id: "v1", name: "結業證書", document: createDefaultDocument() }];

describe("CSV validation", () => {
  it("numbers the first recipient 1 and never silently drops invalid rows", () => {
    const result = validateCsv(
      "recipient_name,recipient_email,certificate_number\n王小明,a@example.test,S-1\n\n陳美玉,wrong,S-2\n",
      single,
    );
    expect(result.valid).toBe(false);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(result.rows[1]?.errors.some((e) => e.field === "recipient_email")).toBe(true);
  });
  it("requires a serial for every recipient and rejects duplicates within the list", () => {
    const result = validateCsv(
      "recipient_name,recipient_email,certificate_number\n王小明,a@example.test,s-001\n陳美玉,b@example.test,Ｓ－００１\n林大同,c@example.test,",
      single,
    );
    expect(result.rows[0]?.data.certificate_number).toBe("S-001");
    expect(result.rows[0]?.errors).toEqual([]);
    expect(result.rows[1]?.errors).toContainEqual({ field: "certificate_number", message: "與第 1 筆的流水號重複" });
    expect(result.rows[2]?.errors).toContainEqual({ field: "certificate_number", message: "證書流水號必填" });
  });
  it("detects duplicate records and allows one email on a distinct certificate row", () => {
    const result = validateCsv(
      "recipient_name,recipient_email,certificate_number,course_name\n王小明,a@example.test,S-1,A\n王小明,a@example.test,S-2,B",
      single,
    );
    expect(result.valid).toBe(true);
  });
  it("blocks oversized batches and duplicate headers", () => {
    expect(() => validateCsv("recipient_name,recipient_name\na,b", single)).toThrow();
    expect(() =>
      validateCsv(
        "recipient_name,recipient_email,certificate_number\n" +
          Array.from({ length: 101 }, (_, i) => `收件人${i},u${i}@example.test,S-${i}`).join("\n"),
        single,
      ),
    ).toThrow("100");
  });
  it("escapes formula prefixes when exporting", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("王小明")).toBe("王小明");
  });
});

describe("several templates in one event", () => {
  const hours = createDefaultDocument();
  hours.fields.push({ key: "hours", label: "時數", type: "number", required: true });
  hours.elements[4]!.text = "時數 {{hours}}";
  const templates = [
    { id: "v1", name: "結業證書", document: createDefaultDocument() },
    { id: "v2", name: "研習時數證明", document: hours },
  ];
  it("picks each recipient's template by name and checks that template's own fields", () => {
    const result = validateBatchRows(
      [
        { rowNumber: 1, data: { recipient_name: "甲", recipient_email: "a@example.test", certificate_number: "A1", template: " 結業證書 " } },
        { rowNumber: 2, data: { recipient_name: "乙", recipient_email: "b@example.test", certificate_number: "A2", template: "研習時數證明" } },
        { rowNumber: 3, data: { recipient_name: "丙", recipient_email: "c@example.test", certificate_number: "A3", template: "研習時數證明", hours: "12" } },
        { rowNumber: 4, data: { recipient_name: "丁", recipient_email: "d@example.test", certificate_number: "A4", template: "不存在" } },
        { rowNumber: 5, data: { recipient_name: "戊", recipient_email: "e@example.test", certificate_number: "A5" } },
      ],
      templates,
    );
    expect(result.rows.map((r) => r.templateVersionId)).toEqual(["v1", "v2", "v2", null, null]);
    expect(result.rows[0]!.errors).toEqual([]);
    expect(result.rows[0]!.data).not.toHaveProperty("template");
    expect(result.rows[1]!.errors.map((e) => e.field)).toContain("hours");
    expect(result.rows[2]!.errors).toEqual([]);
    expect(result.rows[3]!.errors[0]!.message).toContain("找不到模板「不存在」");
    expect(result.rows[4]!.errors[0]!.message).toBe("活動使用多個模板，請填寫模板名稱");
  });
  it("refuses two selected templates that share a name", () => {
    expect(() =>
      validateBatchRows([{ rowNumber: 1, data: {} }], [templates[0]!, { ...templates[1]!, name: "結業證書" }]),
    ).toThrow("模板名稱重複");
  });
});

it("validates explicit issue dates and preserves them", () => {
  const invalid = validateCsv(
    "recipient_name,recipient_email,certificate_number,issue_date\n王小明,a@example.test,S-1,2026-02-30",
    single,
  );
  expect(invalid.valid).toBe(false);
  const valid = validateCsv(
    "recipient_name,recipient_email,certificate_number,issue_date\n王小明,a@example.test,S-1,2026-02-28",
    single,
  );
  expect(valid.valid).toBe(true);
  expect(valid.rows[0]?.data.issue_date).toBe("2026-02-28");
});
