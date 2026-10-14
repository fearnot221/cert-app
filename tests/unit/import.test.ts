import { describe, it, expect } from "vitest";
import { createDefaultDocument } from "@cert/contracts";
import { validateCsv, csvCell } from "../../packages/domain/src/import.js";
describe("CSV validation", () => {
  it("preserves source line numbers and never silently drops invalid rows", () => {
    const result = validateCsv(
      "recipient_name,recipient_email\n王小明,a@example.test\n陳美玉,wrong\n",
      createDefaultDocument(),
    );
    expect(result.valid).toBe(false);
    expect(result.rows[1]?.rowNumber).toBe(3);
    expect(
      result.rows[1]?.errors.some((e) => e.field === "recipient_email"),
    ).toBe(true);
  });
  it("detects duplicate records and allows one email on a distinct certificate row", () => {
    const result = validateCsv(
      "recipient_name,recipient_email,course_name\n王小明,a@example.test,A\n王小明,a@example.test,A\n王小明,a@example.test,B",
      createDefaultDocument(),
    );
    expect(result.rows[1]?.errors).toContainEqual({
      field: "row",
      message: "重複資料",
    });
    expect(result.rows[2]?.errors).toEqual([]);
  });
  it("blocks oversized batches and duplicate headers", () => {
    expect(() =>
      validateCsv(
        "recipient_name,recipient_name\na,b",
        createDefaultDocument(),
      ),
    ).toThrow();
    expect(() =>
      validateCsv(
        "recipient_name,recipient_email\n" +
          Array.from(
            { length: 101 },
            (_, i) => `收件人${i},u${i}@example.test`,
          ).join("\n"),
        createDefaultDocument(),
      ),
    ).toThrow("100");
  });
  it("escapes formula prefixes when exporting", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("王小明")).toBe("王小明");
  });
});

it("validates explicit issue dates and preserves them", () => {
  const invalid = validateCsv(
    "recipient_name,recipient_email,issue_date\n王小明,a@example.test,2026-02-30",
    createDefaultDocument(),
  );
  expect(invalid.valid).toBe(false);
  const valid = validateCsv(
    "recipient_name,recipient_email,issue_date\n王小明,a@example.test,2026-02-28",
    createDefaultDocument(),
  );
  expect(valid.valid).toBe(true);
  expect(valid.rows[0]?.data.issue_date).toBe("2026-02-28");
});
