import { test, expect } from "@playwright/test";
import { choose } from "./select";

test("自訂動態欄位、常駐流水號欄位、PDF 背景與組織網址設定", async ({ page }) => {
  const unique = Date.now().toString();
  await page.goto("/login");
  await page.getByLabel("電子郵件", { exact: true }).fill(process.env.SEED_ADMIN_EMAIL || "admin@example.test");
  await page.getByLabel("密碼", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || "Local-Cert-Only-2026!");
  await page.getByRole("button", { name: "登入工作空間" }).click();
  await expect(page.getByRole("heading", { name: "證書模板", exact: true })).toBeVisible();

  // Organization settings: a short workspace address; old UUID links still land in the workspace.
  const me = await (await page.request.get("/api/auth/me")).json();
  const { id: orgId, slug: original } = me.memberships[0].organization;
  await page.getByRole("link", { name: "組織設定", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${original}/settings$`));
  const slug = `e2e-${unique.slice(-6)}`;
  await page.getByLabel("網址代稱", { exact: true }).fill(`${slug.toUpperCase()}!`);
  await expect(page.getByLabel("網址代稱", { exact: true })).toHaveValue(slug);
  await page.getByRole("button", { name: "儲存網址" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/settings$`));
  await page.goto(`/o/${orgId}/templates`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/templates$`));
  await page.goto(`/${slug}/settings`);
  await page.getByLabel("網址代稱", { exact: true }).fill(original);
  await page.getByRole("button", { name: "儲存網址" }).click();
  await expect(page).toHaveURL(new RegExp(`/${original}/settings$`));

  await page.getByRole("link", { name: "證書模板", exact: true }).click();
  await page.getByRole("button", { name: "建立模板", exact: true }).click();
  await page.getByLabel("模板名稱", { exact: true }).fill(`欄位測試 ${unique}`);
  await page.getByRole("button", { name: "開始設計" }).click();
  await expect(page.getByTestId("certificate-canvas")).toBeVisible();

  // The serial number is always offered and cannot be edited away.
  const serial = page.getByRole("button", { name: "加入動態文字：證書流水號" });
  await expect(serial).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯欄位：證書流水號" })).toHaveCount(0);
  await expect(page.getByTestId("certificate-canvas")).toContainText("STA-2026-0001");

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

  // A PDF background is accepted; its first page is used, and certificates keep it as vectors.
  const printer = await page.context().newPage();
  await printer.setContent('<div style="height:100vh;background:#f3efe2;font:40px serif">背景 PDF</div>');
  const pdf = await printer.pdf({ width: "297mm", height: "210mm", printBackground: true });
  await printer.close();
  await page.locator("input[type=file]").setInputFiles({ name: "background.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/PDF 已設為背景.*向量畫質.*請儲存草稿/)).toBeVisible();

  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("草稿已儲存。")).toBeVisible();
});
