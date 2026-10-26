import { test, expect } from "@playwright/test";
import { choose } from "./select";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

test("芫荽模板 → 批次 PDF → 通知信流水號與密碼 → 手機下載", async ({
  page,
  browser,
}) => {
  const unique = Date.now().toString();
  const eventName = `E2E 中文培訓 ${unique}`;
  const email = `e2e-${unique}@example.test`;
  await page.goto("/login");
  await page
    .getByLabel("電子郵件", { exact: true })
    .fill(process.env.SEED_ADMIN_EMAIL || "admin@example.test");
  await page
    .getByLabel("密碼", { exact: true })
    .fill(process.env.SEED_ADMIN_PASSWORD || "Local-Cert-Only-2026!");
  await page.getByRole("button", { name: "登入工作空間" }).click();
  await expect(
    page.getByRole("heading", { name: "證書模板", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "建立模板", exact: true }).click();
  await page.getByLabel("模板名稱", { exact: true }).fill(`測試證書 ${unique}`);
  await page.getByRole("button", { name: "開始設計" }).click();
  const canvas = page.getByTestId("certificate-canvas");
  await expect(canvas).toBeVisible();
  const background = await sharp({
    create: { width: 1600, height: 1131, channels: 3, background: "#f0f5f2" },
  })
    .png()
    .toBuffer();
  await page.locator("input[type=file]").setInputFiles({
    name: "background.png",
    mimeType: "image/png",
    buffer: background,
  });
  await expect(page.getByText("背景已上傳，請儲存草稿。")).toBeVisible();
  const nameHandle = page.getByRole("button", {
    name: "選取或移動：{{recipient_name}}",
    exact: true,
  });
  const box = await nameHandle.boundingBox();
  if (!box) throw new Error("Missing name element");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 12,
    box.y + box.height / 2 + 6,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("X 位置 mm")).not.toHaveValue("28");
  for (const font of ["標楷風格（cwTeX 楷體）", "仿宋體（cwTeX）"]) {
    await choose(page, "字型", font);
    await expect(page.locator("[data-certificate-page]")).toHaveAttribute("data-layout-status", "ready");
    await page.getByRole("combobox", { name: "字重", exact: true }).click();
    await expect(page.getByRole("option", { name: "粗體 700", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await choose(page, "字型", "芫荽 Iansui");
  await expect(page.locator("[data-certificate-page]")).toHaveAttribute(
    "data-layout-status",
    "ready",
  );
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByText("草稿已儲存。")).toBeVisible();
  await page.getByRole("button", { name: "發布版本", exact: true }).click();
  await expect(
    page.getByText("已發布不可變的新版本，現在可以用於發證活動。"),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  await page.getByRole("link", { name: "發證活動", exact: true }).click();
  await page.getByRole("link", { name: "建立發證活動", exact: true }).click();
  await page.getByLabel("活動名稱", { exact: true }).fill(eventName);
  await page.getByRole("checkbox", { name: `測試證書 ${unique}`, exact: true }).check();
  await page.getByRole("button", { name: "貼上 CSV", exact: true }).click();
  await page
    .getByLabel("或貼上 CSV 內容")
    .fill(
      `recipient_name,recipient_email,certificate_number\n王小明,${email},E2E-${unique}-1\n陳怡君,e2e-second-${unique}@example.test,E2E-${unique}-2`,
    );
  await page.getByRole("button", { name: "檢查名單", exact: true }).click();
  await expect(
    page.getByText("資料檢查通過。建立活動後，請逐人預覽 PDF 確認文字與字型。"),
  ).toBeVisible();
  const batchResponse = page.waitForResponse(
    (r) =>
      /\/organizations\/[^/]+\/batches$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "建立活動並預覽" }).click();
  const created = await (await batchResponse).json();
  const org = created.organizationId;
  const detailUrl = `/api/organizations/${org}/batches/${created.id}`;
  await page
    .getByRole("button", { name: "預覽 PDF", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "完成檢查", exact: true }).click();
  await page.getByRole("button", { name: "確認產製 PDF", exact: true }).click();
  await expect
    .poll(
      async () => {
        const r = await page.request.get(detailUrl);
        return (await r.json()).status;
      },
      { timeout: 60000 },
    )
    .toBe("generated");
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
  await page.getByRole("button", { name: "通知收件人", exact: true }).click();
  await choose(page, "寄件身分", { index: 0 });
  await page.getByRole("button", { name: "檢查發送內容", exact: true }).click();
  await page
    .getByRole("button", { name: "確認通知 2 位收件人", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const r = await page.request.get(detailUrl);
        return (await r.json()).deliveries.filter(
          (d: { status: string }) => d.status === "accepted",
        ).length;
      },
      { timeout: 60000 },
    )
    .toBe(2);
  let messageId = "";
  await expect
    .poll(async () => {
      const response = await fetch("http://127.0.0.1:58025/api/v1/messages");
      const body = await response.json();
      messageId =
        body.messages.find((m: { To: { Address: string }[] }) =>
          m.To.some((t) => t.Address === email),
        )?.ID || "";
      return Boolean(messageId);
    })
    .toBe(true);
  const message = await (
    await fetch(`http://127.0.0.1:58025/api/v1/message/${messageId}`)
  ).json();
  expect(message.Text).toContain(eventName);
  expect(message.Text).toContain(`證書流水號：E2E-${unique}-1`);
  const password = message.Text.match(/下載密碼：([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
  expect(password).toBeTruthy();
  const link = message.Text.match(/http:\/\/localhost:5173\/download\?serial=\S+/)?.[0];
  expect(link).toBeTruthy();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const recipient = await mobile.newPage();
  await recipient.goto(link!);
  await expect(recipient.getByLabel("證書流水號", { exact: true })).toHaveValue(`E2E-${unique}-1`);
  await recipient.getByLabel("下載密碼", { exact: true }).fill("WRONG-PASS-0000");
  await recipient.getByRole("button", { name: "下載 PDF", exact: true }).click();
  await expect(recipient.getByText(/流水號或密碼不正確/)).toBeVisible();
  // Lowercase, without dashes: the same password still works.
  await recipient.getByLabel("下載密碼", { exact: true }).fill(password!.replaceAll("-", "").toLowerCase());
  const pdfDownload = recipient.waitForEvent("download");
  await recipient.getByRole("button", { name: "下載 PDF", exact: true }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe(`E2E-${unique}-1.pdf`);
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(recipient.getByRole("heading", { name: "證書已開始下載" })).toBeVisible();
  await recipient.screenshot({
    path: "test-results/recipient-download-mobile.png",
    fullPage: true,
  });
  await expect(recipient.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await mobile.close();
});

