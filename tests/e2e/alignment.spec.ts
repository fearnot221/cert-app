import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDefaultDocument } from "@cert/contracts";
import { DEFAULT_FONT_PATH } from "@cert/renderer/server";
import { choose } from "./select";

test.use({ viewport: { width: 1600, height: 1050 } });

async function openEditor(page: import("@playwright/test").Page, writable = true) {
  const document = createDefaultDocument();
  document.widthMm = 200;
  document.heightMm = 150;
  document.elements = [
    { ...document.elements[0]!, id: "moving", text: "拖曳元素", x: 20, y: 20, width: 40, height: 20 },
    { ...document.elements[0]!, id: "target", text: "對齊目標", x: 130, y: 90, width: 30, height: 40 },
  ];
  let saved = document;
  const permissions = ["templates.read", ...(writable ? ["templates.write"] : [])];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: {
      user: { id: "user", email: "guide@example.test" },
      memberships: [{ organization: { id: "org", slug: "alignment", name: "對齊測試" }, role: "Owner", permissions }],
    } });
    if (path === "/api/auth/csrf") return route.fulfill({ json: { csrfToken: "fixture" } });
    if (path === "/api/fonts/noto-sans-tc") return route.fulfill({ contentType: "font/ttf", body: await readFile(DEFAULT_FONT_PATH) });
    if (path === "/api/organizations/org/templates/template") {
      if (route.request().method() === "PUT") saved = route.request().postDataJSON().document;
      return route.fulfill({ json: { id: "template", name: "對齊測試", document: saved, revision: 1, status: "draft", versions: [] } });
    }
    return route.abort();
  });
  await page.goto("/alignment/templates/template");
  await expect(page.locator("[data-certificate-page]")).toHaveAttribute("data-layout-status", "ready");
  return () => saved;
}

test("拖曳時對齊畫布與其他元素，縮放後仍吸附，放開後清除且不儲存輔助線", async ({ page }) => {
  const saved = await openEditor(page);
  const moving = page.getByRole("button", { name: "選取或移動：拖曳元素", exact: true });
  const canvas = page.getByTestId("certificate-canvas");
  for (const zoom of [50, 100]) {
    await page.getByLabel("X 位置 mm", { exact: true }).fill("20");
    await page.getByLabel("Y 位置 mm", { exact: true }).fill("20");
    await choose(page, "畫布縮放", `${zoom}%`);
    await moving.scrollIntoViewIfNeeded();
    const box = (await moving.boundingBox())!;
    const sheet = (await canvas.boundingBox())!;
    const pixelsPerMm = sheet.width / 200;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Stop just before the page midpoint, within the five-screen-pixel threshold.
    await page.mouse.move(sheet.x + 100 * pixelsPerMm - 3, sheet.y + 75 * pixelsPerMm - 3, { steps: 5 });
    await expect(canvas.locator('[data-alignment-axis="x"]')).toHaveAttribute("x1", "100");
    await expect(canvas.locator('[data-alignment-axis="y"]')).toHaveAttribute("y1", "75");
    await expect(page.getByLabel("X 位置 mm", { exact: true })).toHaveValue("80");
    await expect(page.getByLabel("Y 位置 mm", { exact: true })).toHaveValue("65");
    await canvas.screenshot({ path: `.runtime/alignment-${zoom}.png` });
    await page.mouse.move(sheet.x + 67 * pixelsPerMm, sheet.y + 48 * pixelsPerMm);
    await expect(canvas.locator(".alignment-guides")).toHaveCount(0);
    // Move the dragged element's top/left close to the other element's top/left.
    await page.mouse.move(sheet.x + 150 * pixelsPerMm - 2, sheet.y + 100 * pixelsPerMm - 2);
    await expect(canvas.locator('[data-alignment-axis="x"]')).toHaveAttribute("x1", "130");
    await expect(canvas.locator('[data-alignment-axis="y"]')).toHaveAttribute("y1", "90");
    await page.mouse.up();
    await expect(canvas.locator(".alignment-guides")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("草稿已儲存。", { exact: true })).toBeVisible();
  expect(saved().elements[0]).toMatchObject({ x: 130, y: 90 });
  expect(JSON.stringify(saved())).not.toContain("guides");

  const box = (await moving.boundingBox())!;
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2 + 1);
  await expect(canvas.locator(".alignment-guides")).toHaveCount(1);
  await moving.dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(canvas.locator(".alignment-guides")).toHaveCount(0);
  await page.mouse.up();
});

test("唯讀模板不能拖曳或顯示對齊線", async ({ page }) => {
  await openEditor(page, false);
  const moving = page.getByRole("button", { name: "選取或移動：拖曳元素", exact: true });
  const box = (await moving.boundingBox())!;
  const before = await moving.getAttribute("style");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30);
  await page.mouse.up();
  await expect(moving).toHaveAttribute("style", before!);
  await expect(page.locator(".alignment-guides")).toHaveCount(0);
});
