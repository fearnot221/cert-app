import { test, expect } from "@playwright/test";
import { createDefaultDocument } from "@cert/contracts";
import { choose } from "./select";

test("建立活動統一使用最新版模板，手機不顯示版本選單或擠壓模板名稱", async ({ page }) => {
  const unique = Date.now().toString();
  await page.goto("/login");
  await page.getByLabel("電子郵件", { exact: true }).fill(process.env.SEED_ADMIN_EMAIL || "admin@example.test");
  await page.getByLabel("密碼", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || "Local-Cert-Only-2026!");
  await page.getByRole("button", { name: "登入工作空間" }).click();
  await expect(page.getByRole("heading", { name: "證書模板", exact: true })).toBeVisible();
  const me = await (await page.request.get("/api/auth/me")).json();
  const { id: org, slug } = me.memberships[0].organization;
  const csrf = (await (await page.request.get("/api/auth/csrf")).json()).csrfToken;
  const write = async (method: "post" | "put", path: string, data: unknown) => {
    const response = await page.request[method](`/api/organizations/${org}${path}`, {
      data, headers: { "X-CSRF-Token": csrf },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const name = `志工感謝狀 ${unique}`;
  const longName = `社區志工服務與專業培訓結業證書${"長名稱排版檢查".repeat(6)} ${unique}`;
  const published = [];
  for (const templateName of [name, longName]) {
    const document = createDefaultDocument();
    const template = await write("post", "/templates", { name: templateName, document });
    const first = await write("post", `/templates/${template.id}/publish`, {});
    document.elements[0]!.text = "最新版證書";
    const updated = await write("put", `/templates/${template.id}`, { name: templateName, document, revision: template.revision });
    const latest = await write("post", `/templates/${template.id}/publish`, {});
    expect(latest.number).toBe(2);
    expect(latest.id).not.toBe(first.id);
    // A saved but unpublished draft must not replace the latest published version.
    document.elements[0]!.text = "未發布草稿";
    await write("put", `/templates/${template.id}`, { name: templateName, document, revision: updated.revision });
    published.push({ name: templateName, id: latest.id });
  }
  await page.goto(`/${slug}/batches/new`);
  const picker = page.getByRole("group", { name: "證書模板", exact: true });
  await expect(picker.getByText(/統一使用最新已發布版本/)).toBeVisible();
  for (const template of published) {
    await picker.getByRole("checkbox", { name: template.name, exact: true }).check();
  }
  await expect(picker.getByRole("combobox")).toHaveCount(0);
  await expect(picker.getByText(/第\s*\d+\s*版/)).toHaveCount(0);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await picker.locator("li").filter({ hasText: longName }).evaluate((item) => {
      const name = item.querySelector(".template-picker-name")!;
      return { itemWidth: item.getBoundingClientRect().width, parentWidth: item.parentElement!.getBoundingClientRect().width, nameWidth: name.getBoundingClientRect().width, scroll: item.scrollWidth, client: item.clientWidth };
    });
    expect(bounds.itemWidth).toBeLessThanOrEqual(bounds.parentWidth + 1);
    expect(bounds.nameWidth).toBeGreaterThan(100);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
    await picker.screenshot({ path: `test-results/latest-template-${width}.png` });
  }
  await page.getByLabel("活動名稱", { exact: true }).fill(`最新版活動 ${unique}`);
  await page.getByRole("button", { name: "手動新增", exact: true }).click();
  await page.getByRole("button", { name: "新增收件人", exact: true }).click();
  for (const [index, template] of published.entries()) {
    await page.getByLabel(`第 ${index + 1} 人姓名`, { exact: true }).fill(`收件人${index + 1}`);
    await page.getByLabel(`第 ${index + 1} 人Email`, { exact: true }).fill(`latest-${unique}-${index}@example.test`);
    await page.getByLabel(`第 ${index + 1} 人證書流水號`, { exact: true }).fill(`LATEST-${unique}-${index}`);
    await choose(page, `第 ${index + 1} 人的模板`, template.name);
  }
  const checked = page.waitForResponse((response) => response.url().endsWith("/batches/validate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "檢查名單", exact: true }).click();
  const validation = await (await checked).json();
  expect(validation.valid).toBe(true);
  expect(validation.templates.map((template: { id: string }) => template.id).sort()).toEqual(published.map((template) => template.id).sort());
  const created = page.waitForResponse((response) => response.url().endsWith("/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "建立活動並預覽", exact: true }).click();
  const batch = await (await created).json();
  const detail = await (await page.request.get(`/api/organizations/${org}/batches/${batch.id}`)).json();
  expect(detail.rows.map((row: { templateVersionId: string }) => row.templateVersionId)).toEqual(published.map((template) => template.id));
});
