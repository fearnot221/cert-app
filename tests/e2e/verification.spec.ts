import { test, expect } from '@playwright/test';
import { createDefaultDocument } from '@cert/contracts';
import { randomUUID } from 'node:crypto';

test('流水號查詢無需登入，不顯示持有人資料；期限調整、到期、補發及撤銷', async ({ page, browser }) => {
  const unique = Date.now().toString();
  const name = `流水號查詢 ${unique}`;
  const serial = `VERIFY-${unique}`;
  await page.goto('/login');
  await page.getByLabel('電子郵件', { exact: true }).fill(process.env.SEED_ADMIN_EMAIL || 'admin@example.test');
  await page.getByLabel('密碼', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || 'Local-Cert-Only-2026!');
  await page.getByRole('button', { name: '登入工作空間' }).click();
  await expect(page.getByRole('heading', { name: '證書模板', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const org = me.memberships[0].organization.id;
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api/organizations/${org}${path}`, { data, headers: { 'X-CSRF-Token': csrf } });
    expect(r.ok(), await r.text()).toBeTruthy(); return r;
  };
  const template = await (await post('/templates', { name, document: createDefaultDocument() })).json();
  const version = await (await post(`/templates/${template.id}/publish`, {})).json();
  const batch = await (await post('/batches', { eventName: name, templateVersionIds: [version.id], expiresOn: '2099-12-31', idempotencyKey: randomUUID(), records: [{ rowNumber: 1, data: { recipient_name: '驗證學員', recipient_email: `verify-${unique}@example.test`, certificate_number: serial.toLowerCase() } }] })).json();
  const detailPath = `/api/organizations/${org}/batches/${batch.id}`;
  let detail = await (await page.request.get(detailPath)).json();
  expect(detail.rows[0].data.certificate_number).toBe(serial);
  await post(`/batches/${batch.id}/preview`, { rowId: detail.rows[0].id });
  await post(`/batches/${batch.id}/generate`, {});
  await expect.poll(async () => (await (await page.request.get(detailPath)).json()).status, { timeout: 60000 }).toBe('generated');
  await page.getByRole('link', { name: '發證活動', exact: true }).click();
  await page.getByLabel('搜尋活動', { exact: true }).fill(name);
  await page.getByRole('link', { name: `開啟活動：${name}`, exact: true }).click();
  await expect(page.getByText(serial, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('驗證連結與 QR Code')).toHaveCount(0);
  const anonymous = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 } });
  const publicPage = await anonymous.newPage();
  try {
    // The home page lookup goes straight to the result page.
    await publicPage.goto('/');
    await publicPage.getByLabel('證書流水號', { exact: true }).fill(serial.toLowerCase());
    await publicPage.getByRole('button', { name: '查詢', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: '這是有效的證書' })).toBeVisible();
    await expect(publicPage.getByText(name, { exact: true })).toBeVisible();
    await expect(publicPage.getByText('驗證學員')).toHaveCount(0);
    await expect(publicPage.getByText(`verify-${unique}@example.test`)).toHaveCount(0);
    await expect(publicPage.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await publicPage.screenshot({ path: 'test-results/serial-valid-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '管理期限', exact: true }).click();
    let modal = page.getByRole('dialog');
    await modal.getByLabel('證書到期日（選填）').fill('2000-01-01');
    await modal.getByLabel('操作原因').fill('測試到期狀態');
    await modal.getByRole('button', { name: '確認調整有效期限' }).click();
    await expect(modal).toHaveCount(0);
    await publicPage.getByRole('button', { name: '重新查詢' }).click();
    await expect(publicPage.getByRole('heading', { name: '這張證書已到期' })).toBeVisible();
    await page.getByRole('button', { name: '管理期限', exact: true }).click();
    modal = page.getByRole('dialog');
    await modal.getByLabel('證書到期日（選填）').fill('2099-12-31');
    await modal.getByLabel('操作原因').fill('續期');
    await modal.getByRole('button', { name: '確認調整有效期限' }).click();
    await expect(modal).toHaveCount(0);
    // A reissue keeps the serial, so the lookup follows the new edition.
    await page.getByRole('button', { name: '重新發放', exact: true }).click();
    modal = page.getByRole('dialog');
    await expect(modal.getByLabel('證書流水號', { exact: true })).toHaveValue(serial);
    await modal.getByLabel('操作原因').fill('以新版取代');
    await modal.getByRole('button', { name: '確認重新發放證書' }).click();
    await expect(modal).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(detailPath)).json()).status, { timeout: 60000 }).toBe('generated');
    await publicPage.getByRole('button', { name: '重新查詢' }).click();
    await expect(publicPage.getByRole('heading', { name: '這是有效的證書' })).toBeVisible();
    detail = await (await page.request.get(detailPath)).json();
    expect(detail.rows[0].certificate.number).toBe(serial);
    await post(`/certificates/${detail.rows[0].certificate.id}/revoke`, { reason: '撤銷新版' });
    await publicPage.getByRole('button', { name: '重新查詢' }).click();
    await expect(publicPage.getByRole('heading', { name: '這張證書已撤銷' })).toBeVisible();
    await publicPage.goto(`/verify/NOPE-${unique}`);
    await expect(publicPage.getByRole('heading', { name: '查無這個流水號' })).toBeVisible();
    // Old QR links land on a page that explains QR checks are gone.
    await publicPage.goto(`/verify/${randomUUID()}`);
    await expect(publicPage.getByRole('heading', { name: 'QR Code 驗證已停用' })).toBeVisible();
  } finally { await anonymous.close(); }
});
