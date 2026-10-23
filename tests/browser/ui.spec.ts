import { test, expect } from '@playwright/test';

test('Persian RTL shell, keyboard composer, theme persistence and responsive layout', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByRole('heading', { name: 'امروز چطور کمکت کنم؟' })).toBeVisible();
  await page.getByRole('button', { name: 'فعال کردن تم تاریک' }).click();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'فعال کردن تم روشن' }).click();
  await page.getByRole('button', { name: /پرسش دربارهٔ لیارا/ }).click();
  await expect(page.getByRole('textbox', { name: 'درخواست خود را بنویسید' })).toHaveValue('در مورد امکانات لیارا و انتخاب گزینهٔ مناسب برای وب‌سایتم راهنمایی‌ام کن.');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'درخواست خود را بنویسید' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('TEST FIXTURE: auth-required state is explicit and does not enable sending', async ({ page }) => {
  // Mock only this UI-state test; it is not evidence of real runtime authentication.
  const codex = { state: 'auth_required', message: 'برای ورود دستور codex login را اجرا کنید.', verifiedConversation: false };
  await page.route('**/api/status', route => route.fulfill({ json: { codex } }));
  await page.route('**/api/connect', route => route.fulfill({ json: { codex } }));
  await page.goto('/');
  await expect(page.locator('header').getByText('نیاز به ورود به Codex', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'درخواست خود را بنویسید' }).fill('test');
  await expect(page.getByRole('button', { name: 'ارسال پیام' })).toBeDisabled();
});

test('TEST FIXTURE: stream errors stay partial and hostile output renders as text', async ({ page }) => {
  const codex = { state: 'ready', message: 'test fixture', verifiedConversation: false };
  await page.route('**/api/status', route => route.fulfill({ json: { codex } }));
  await page.route('**/api/connect', route => route.fulfill({ json: { codex } }));
  await page.route('**/api/chat', route => route.fulfill({
    contentType: 'text/event-stream', body: [
      { type: 'delta', itemId: 'fixture', text: '<img src=x onerror="window.__injected=true">' },
      { type: 'error', code: 'fixture_error', message: 'پاسخ آزمایشی قطع شد.' },
      { type: 'done', status: 'failed' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'گفت‌وگوی تازه', exact: true }).click();
  await page.getByRole('textbox', { name: 'درخواست خود را بنویسید' }).fill('test fixture');
  await page.getByRole('button', { name: 'ارسال پیام' }).click();
  await expect(page.locator('.message.assistant p')).toContainText('<img');
  await expect(page.locator('.message.assistant img')).toHaveCount(0);
  await expect(page.getByText('پاسخ کامل نشده است', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('پاسخ آزمایشی قطع شد.');
  expect(await page.evaluate(() => '__injected' in window)).toBe(false);
  await page.getByRole('button', { name: 'گفت‌وگوی تازه', exact: true }).click();
  await expect(page.locator('.message')).toHaveCount(0);
  await page.reload();
  await page.getByRole('textbox', { name: 'درخواست خود را بنویسید' }).fill('follow-up');
  await expect(page.getByRole('button', { name: 'ارسال پیام' })).toBeEnabled();
});
