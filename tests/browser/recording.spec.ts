import { test, expect } from '@playwright/test';

test('offline recording plays all eight chapters, pauses, resets, and stops at 04:20 without API requests', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/?demo=recording');
  await page.clock.install();
  await page.getByRole('button', { name: 'پخش خودکار ۴:۲۰', exact: true }).click();
  await page.clock.runFor(8000);
  await expect(page.locator('.rec-assistant-bubble')).toContainText('حتماً');
  await page.getByRole('button', { name: 'توقف موقت', exact: true }).click();
  const paused = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  await page.clock.runFor(5000);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', paused!);
  await page.getByRole('button', { name: 'ادامهٔ پخش', exact: true }).click();
  let elapsed = 8;
  for (const [target, title] of [[33, 'معرفی پروژه'], [58, 'دیدن خطای پرداخت'], [93, 'از شواهد تا علت'], [128, 'تعمیر در نسخهٔ جدا'], [173, 'تصمیم انتشار با کاربر'], [208, 'بررسی نتیجه'], [243, 'یک مسیر قابل پیگیری']] as const) {
    await page.clock.runFor((target - elapsed) * 1000);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    elapsed = target;
  }
  await page.clock.runFor((260 - elapsed) * 1000 + 500);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '260');
  await expect(page.getByRole('button', { name: 'پخش دوباره', exact: true })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '260');
  await page.getByRole('button', { name: 'شروع دوبارهٔ دمو', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('یک درخواست ساده');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  expect(apiRequests).toEqual([]);
});

test('recording requires manual approval and offers cancel, failure and reconciliation paths', async ({ page }) => {
  await page.goto('/?demo=recording');
  await page.clock.install();
  await page.getByRole('navigation', { name: 'فصل‌های دمو' }).getByRole('button', { name: /تصمیم انتشار با کاربر/ }).click();
  const approve = page.getByRole('button', { name: 'تأیید انتشار نمایشی', exact: true });
  await expect(approve).toBeDisabled();
  await page.getByRole('button', { name: 'لغو انتشار', exact: true }).click();
  await expect(page.locator('.rec-error-note')).toContainText('نسخهٔ قبلی حفظ');
  await page.getByRole('button', { name: 'بازبینی دوباره', exact: true }).click();
  await page.getByRole('button', { name: 'شکست ساخت', exact: true }).click();
  await page.getByRole('checkbox').check();
  await approve.click();
  await page.clock.runFor(4500);
  await expect(page.locator('.rec-error-note')).toContainText('ساخت نمونه ناموفق');
  await page.getByRole('button', { name: 'اصلاح و تلاش دوباره', exact: true }).click();
  await page.getByRole('button', { name: 'پاسخ نامشخص', exact: true }).click();
  await page.getByRole('checkbox').check();
  await approve.click();
  await page.clock.runFor(4500);
  await expect(page.locator('.rec-uncertain-note')).toContainText('ارسال دوباره انجام نمی‌شود');
  await page.getByRole('button', { name: 'استعلام وضعیت نمایشی', exact: true }).click();
  await expect(page.locator('.rec-success-line')).toContainText('قبلاً کامل');
});

test('local Persian font loads and every recording chapter fits mobile width', async ({ page }) => {
  await page.goto('/?demo=recording');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family === 'Vazirmatn' && font.status === 'loaded'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const chapters = page.getByRole('navigation', { name: 'فصل‌های دمو' }).getByRole('button');
  for (let index = 0; index < 8; index++) {
    await chapters.nth(index).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
