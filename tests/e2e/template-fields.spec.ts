import { test, expect } from "@playwright/test";
import { choose } from "./select";

test("自訂動態欄位、常駐流水號欄位、PDF 背景與組織流水號設定", async ({ page }) => {
  const unique = Date.now().toString();
  const prefix = `E2E${unique.slice(-5)}`;
  await page.goto("/login");
  await page.getByLabel("電子郵件", { exact: true }).fill(process.env.SEED_ADMIN_EMAIL || "admin@example.test");
  await page.getByLabel("密碼", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || "Local-Cert-Only-2026!");
  await page.getByRole("button", { name: "登入工作空間" }).click();
  await expect(page.getByRole("heading", { name: "證書模板", exact: true })).toBeVisible();

  // Organization settings: the serial number format, previewed as it will be printed.
  await page.getByRole("link", { name: "組織設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "證書流水號" })).toBeVisible();
  await page.getByLabel("前綴", { exact: true }).fill(prefix.toLowerCase());
  await expect(page.getByLabel("前綴", { exact: true })).toHaveValue(prefix);
  await choose(page, "號碼位數", "5 位（00001）");
  await expect(page.locator(".serial-next")).toHaveText(new RegExp(`^${prefix}-\\d{5,}$`));
  await page.getByRole("button", { name: "儲存編號規則" }).click();
  await expect(page.getByText(`已更新。下一張證書的編號是 ${prefix}-`, { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "證書模板", exact: true }).click();
  await page.getByRole("button", { name: "建立模板", exact: true }).click();
  await page.getByLabel("模板名稱", { exact: true }).fill(`欄位測試 ${unique}`);
  await page.getByRole("button", { name: "開始設計" }).click();
  await expect(page.getByTestId("certificate-canvas")).toBeVisible();

  // The serial number is always offered and cannot be edited away.
  const serial = page.getByRole("button", { name: "加入動態文字：證書流水號" });
  await expect(serial).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯欄位：證書流水號" })).toHaveCount(0);
  // The new template's sample serial follows the organization setting.
  await expect(page.getByTestId("certificate-canvas")).toContainText(new RegExp(`證書編號 ${prefix}-\\d{5,}`));

  await page.getByRole("button", { name: "新增自訂欄位" }).click();
  await page.getByLabel("欄位名稱", { exact: true }).fill("課程時數");
  await page.getByLabel("欄位代碼", { exact: true }).fill("course_hours");
  await choose(page, "資料類型", "數字");
  await page.getByRole("button", { name: "加入欄位" }).click();
  await page.getByRole("button", { name: "加入動態文字：課程時數" }).click();
  await expect(page.getByRole("button", { name: "選取或移動：{{course_hours}}", exact: true })).toBeVisible();
  await expect(page.locator(".layer-item").filter({ hasText: "〔課程時數〕" })).toBeVisible();

  // A used field cannot be deleted until the text that uses it is gone.
  await page.getByRole("button", { name: "編輯欄位：課程時數" }).click();
  await page.getByRole("button", { name: "刪除欄位" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "有 1 個文字框使用這個欄位" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  // A PDF background is accepted and turned into an image from its first page.
  const printer = await page.context().newPage();
  await printer.setContent('<div style="height:100vh;background:#f3efe2;font:40px serif">背景 PDF</div>');
  const pdf = await printer.pdf({ width: "297mm", height: "210mm", printBackground: true });
  await printer.close();
  await page.locator("input[type=file]").setInputFiles({ name: "background.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/PDF 已轉為背景圖.*請儲存草稿/)).toBeVisible();

  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("草稿已儲存。")).toBeVisible();
});
