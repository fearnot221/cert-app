import { test, expect } from "@playwright/test";
import { choose } from "./select";
import sharp from "sharp";

test("芫荽模板 → 批次 PDF → 重發啟用 → 手機下載 → 重設密碼", async ({
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
  await choose(page, "模板版本", `測試證書 ${unique} · 第 1 版`);
  await page.getByRole("button", { name: "貼上 CSV", exact: true }).click();
  await page
    .getByLabel("或貼上 CSV 內容")
    .fill(
      `recipient_name,recipient_email\n王小明,${email}\n陳怡君,e2e-second-${unique}@example.test`,
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
  expect(message.Text).toContain("24 小時");
  expect(message.Text).toContain(eventName);
  expect(message.Text).not.toContain("臨時密碼");
  const activation = message.Text.match(
    /http:\/\/localhost:5173\/activate#token=[A-Za-z0-9_-]+/,
  )?.[0];
  expect(activation).toBeTruthy();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const recipient = await mobile.newPage();
  await recipient.goto(activation!);
  await recipient
    .getByRole("button", { name: "重發啟用信", exact: true })
    .click();
  await recipient.getByLabel("電子郵件", { exact: true }).fill(email);
  await recipient
    .getByRole("button", { name: "寄送連結", exact: true })
    .click();
  await expect(
    recipient.getByText(
      "若帳號符合條件，我們會寄送連結。請檢查信箱，稍候再申請。",
    ),
  ).toBeVisible();
  const resent = await accountMessage(email, "重新啟用");
  const resentLink = resent.Text.match(
    /http:\/\/localhost:5173\/activate#token=[A-Za-z0-9_-]+/,
  )![0];
  await recipient.goto(resentLink);
  await recipient
    .getByLabel("設定密碼", { exact: true })
    .fill("Recipient-Unique-Password-2026!");
  await recipient
    .getByLabel("再次輸入密碼", { exact: true })
    .fill("Recipient-Unique-Password-2026!");
  await recipient.getByRole("button", { name: "啟用帳號並繼續" }).click();
  await expect(
    recipient.getByRole("heading", { name: "我的證書", exact: true }),
  ).toBeVisible();
  await expect(
    recipient.getByRole("navigation", { name: "主要導覽" }),
  ).toHaveCount(0);
  await recipient.getByRole("button", { name: "登出", exact: true }).click();
  await recipient.getByLabel("電子郵件", { exact: true }).fill(email);
  await recipient
    .getByLabel("密碼", { exact: true })
    .fill("Recipient-Unique-Password-2026!");
  await recipient.getByRole("button", { name: "登入工作空間" }).click();
  await expect(recipient.getByText(eventName, { exact: true })).toBeVisible();
  const own = await (
    await recipient.request.get("/api/me/certificates")
  ).json();
  expect(own.items).toHaveLength(1);
  const pdf = await recipient.request.get(
    `/api/me/certificates/${own.items[0].id}/pdf`,
  );
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await recipient.screenshot({
    path: "test-results/recipient-mobile.png",
    fullPage: true,
  });
  await expect(recipient.locator("body")).toHaveJSProperty("scrollWidth", 390);
  const recoveryContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const recovery = await recoveryContext.newPage();
  await recovery.goto("/login");
  await recovery.getByRole("button", { name: "忘記密碼", exact: true }).click();
  await recovery.getByLabel("電子郵件", { exact: true }).fill(email);
  await recovery.getByRole("button", { name: "寄送連結", exact: true }).click();
  const reset = await accountMessage(email, "重設你的");
  const resetLink = reset.Text.match(
    /http:\/\/localhost:5173\/reset-password#token=[A-Za-z0-9_-]+/,
  )![0];
  await recovery.goto(resetLink);
  await expect(recovery).toHaveURL("http://localhost:5173/reset-password");
  await recovery
    .getByLabel("設定密碼", { exact: true })
    .fill("Replacement-Unique-2026!");
  await recovery
    .getByLabel("再次輸入密碼", { exact: true })
    .fill("Replacement-Unique-2026!");
  await recovery
    .getByRole("button", { name: "儲存新密碼", exact: true })
    .click();
  await expect(
    recovery.getByText("密碼已更新，所有舊登入均已失效。請使用新密碼登入。"),
  ).toBeVisible();
  expect((await recipient.request.get("/api/auth/me")).status()).toBe(401);
  await recovery.getByLabel("電子郵件", { exact: true }).fill(email);
  await recovery
    .getByLabel("密碼", { exact: true })
    .fill("Replacement-Unique-2026!");
  await recovery.getByRole("button", { name: "登入工作空間" }).click();
  await expect(
    recovery.getByRole("heading", { name: "我的證書", exact: true }),
  ).toBeVisible();
  await recoveryContext.close();
  await mobile.close();
});

async function accountMessage(
  email: string,
  subject: string,
): Promise<{ Text: string }> {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `http://127.0.0.1:58025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const result = await response.json();
        id =
          result.messages.find((m: { Subject: string }) =>
            m.Subject.includes(subject),
          )?.ID || "";
        return !!id;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  return (await fetch(`http://127.0.0.1:58025/api/v1/message/${id}`)).json();
}
