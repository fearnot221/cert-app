import { test, expect } from "@playwright/test";
import { choose } from "./select";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

test("Excel 工作表與欄位對應、錯誤報告、批次 ZIP、活動篩選與手動名單", async ({
  page,
}) => {
  const unique = Date.now().toString();
  const name = `Excel 發證 ${unique}`;
  await page.goto("/login");
  await page
    .getByLabel("電子郵件", { exact: true })
    .fill(process.env.SEED_ADMIN_EMAIL || "admin@example.test");
  await page
    .getByLabel("密碼", { exact: true })
    .fill(process.env.SEED_ADMIN_PASSWORD || "Local-Cert-Only-2026!");
  await page.getByRole("button", { name: "登入工作空間" }).click();
  await page.getByRole("link", { name: "發證活動", exact: true }).click();
  await page.getByRole("link", { name: "建立發證活動", exact: true }).click();
  await page.getByLabel("活動名稱", { exact: true }).fill(name);
  await choose(page, "模板版本", { index: 0 });
  const book = new ExcelJS.Workbook();
  const other = book.addWorksheet("備用");
  other.addRow(["姓名", "Email"]);
  other.addRow(["備用名單", `unused-${unique}@example.test`]);
  const sheet = book.addWorksheet("發證名單");
  sheet.addRow(["學員姓名", "電子郵件", "發證日期"]);
  sheet.addRow([
    "王小明",
    `zip-${unique}@example.test`,
    new Date("2026-10-15T00:00:00Z"),
  ]);
  sheet.addRow([]);
  sheet.addRow(["陳怡君", "wrong-email", new Date("2026-10-16T00:00:00Z")]);
  const upload = async () => {
    await page
      .getByLabel("上傳收件人名單", { exact: true })
      .setInputFiles({
        name: "培訓名單.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await book.xlsx.writeBuffer()),
      });
    await choose(page, "工作表", "發證名單（2 筆）");
    await choose(page, "對應姓名", "學員姓名");
  };
  await upload();
  await page.getByRole("button", { name: "檢查名單", exact: true }).click();
  await expect(page.getByText("2 筆資料 · 1 筆需要修正")).toBeVisible();
  const reportDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載檢查失敗報告", exact: true })
    .click();
  const report = await reportDownload;
  const reportText = await readFile((await report.path())!, "utf8");
  expect(reportText).toContain('"4"');
  expect(reportText).toContain("Email 格式不正確");
  sheet.getCell("B4").value = `zip-second-${unique}@example.test`;
  await upload();
  await page.getByRole("button", { name: "檢查名單", exact: true }).click();
  await expect(page.getByText("2 筆資料 · 0 筆需要修正")).toBeVisible();
  await page.screenshot({
    path: "test-results/excel-import.png",
    fullPage: true,
  });
  const createdResponse = page.waitForResponse(
    (r) =>
      /\/organizations\/[^/]+\/batches$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "建立活動並預覽" }).click();
  const batch = await (await createdResponse).json();
  const detailPath = `/api/organizations/${batch.organizationId}/batches/${batch.id}`;
  await page
    .getByRole("button", { name: "預覽 PDF", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "完成檢查", exact: true }).click();
  await page.getByRole("button", { name: "確認產製 PDF", exact: true }).click();
  await expect
    .poll(
      async () => (await (await page.request.get(detailPath)).json()).status,
      { timeout: 60000 },
    )
    .toBe("generated");
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下載全部成功 ZIP（2）", exact: true }),
  ).toBeEnabled();
  const allDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載全部成功 ZIP（2）", exact: true })
    .click();
  const entries = unzipSync(
    await readFile((await (await allDownload).path())!),
  );
  expect(Object.keys(entries)).toHaveLength(2);
  for (const data of Object.values(entries))
    expect(Buffer.from(data).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByLabel("搜尋收件人", { exact: true }).fill("王小明");
  await page.getByLabel("勾選目前顯示的成功證書", { exact: true }).check();
  const selectionDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載勾選 ZIP（1）", exact: true })
    .click();
  expect(
    Object.keys(
      unzipSync(await readFile((await (await selectionDownload).path())!)),
    ),
  ).toHaveLength(1);
  await page.getByLabel("搜尋收件人", { exact: true }).fill("");
  await page.screenshot({
    path: "test-results/batch-detail.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "test-results/batch-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "返回發證活動", exact: true }).click();
  await page.getByLabel("搜尋活動", { exact: true }).fill(name);
  await choose(page, "活動狀態", "已產製");
  await page.screenshot({
    path: "test-results/batch-list.png",
    fullPage: true,
  });
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "建立發證活動", exact: true }).click();
  await page.getByLabel("活動名稱", { exact: true }).fill(`手動 ${unique}`);
  await choose(page, "模板版本", { index: 0 });
  await page.getByRole("button", { name: "手動新增", exact: true }).click();
  await page.getByLabel("第 1 人姓名", { exact: true }).fill("手動學員");
  await page
    .getByLabel("第 1 人Email", { exact: true })
    .fill(`manual-${unique}@example.test`);
  await page.getByRole("button", { name: "檢查名單", exact: true }).click();
  await expect(page.getByText("1 筆資料 · 0 筆需要修正")).toBeVisible();
  const manualResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/batches"));
  await page.getByRole("button", { name: "建立活動並預覽" }).click();
  const manualId = (await (await manualResponse).json()).id;
  const manualPath = detailPath.replace(/[^/]+$/, manualId);
  await expect(
    page.getByRole("heading", { name: `手動 ${unique}`, exact: true }),
  ).toBeVisible();

  await expect(page.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await expect(page.getByText('來源列號 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '編輯活動', exact: true }).click();
  let modal = page.getByRole('dialog');
  await modal.getByLabel('活動名稱', { exact: true }).fill(`已編輯 ${unique}`);
  await modal.getByLabel('姓名', { exact: true }).fill('更正學員');
  await modal.getByLabel('操作原因').fill('更正活動及姓名');
  await modal.getByRole('button', { name: '確認編輯活動', exact: true }).click();
  await expect(page.getByRole('heading', { name: `已編輯 ${unique}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '預覽 PDF', exact: true }).click();
  await page.getByRole('button', { name: '完成檢查', exact: true }).click();
  await page.getByRole('button', { name: '確認產製 PDF', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(manualPath)).json()).status, { timeout: 60000 }).toBe('generated');
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await page.getByRole('button', { name: '撤銷', exact: true }).click();
  modal = page.getByRole('dialog');
  await modal.getByLabel('操作原因').fill('撤回錯誤姓名');
  await modal.getByRole('button', { name: '確認撤銷證書', exact: true }).click();
  await expect(page.getByRole('button', { name: '正式 PDF', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重新發放', exact: true }).click();
  modal = page.getByRole('dialog');
  await modal.getByLabel('姓名', { exact: true }).fill('補發學員');
  await modal.getByLabel('操作原因').fill('依正確姓名補發');
  await modal.getByRole('button', { name: '確認重新發放證書', exact: true }).click();
  // The batch was already "generated" before the reissue, so wait for the dialog to close and then on the row itself.
  await expect(modal).toHaveCount(0);
  await expect.poll(async () => {
    const reissued = await (await page.request.get(manualPath)).json();
    return `${reissued.status}/${reissued.rows[0].status}`;
  }, { timeout: 60000 }).toBe('generated/success');
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await expect(page.getByText('2 個版本', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '正式 PDF', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '操作紀錄', exact: true }).click();
  await expect(page.getByText('依正確姓名補發', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/lifecycle-history.png', fullPage: true });
  await page.getByRole('button', { name: '取消活動', exact: true }).click();
  modal = page.getByRole('dialog');
  await modal.getByLabel('操作原因').fill('活動結束後撤回測試證書');
  await modal.getByRole('button', { name: '確認取消活動', exact: true }).click();
  await expect(page.getByText('活動已取消：活動結束後撤回測試證書', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/lifecycle-mobile.png', fullPage: true });
});
