import { test, expect } from '@playwright/test';
import { makeTestZip } from '../fixtures/make-zip.js';

test('MOCK CATALOG: manual deployment guide inspects ZIP locally, explains choices, and never dispatches cloud changes', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) seen.push(request.method() + ' ' + new URL(request.url()).pathname); });
  await page.route('**/api/liara/test-options', route => route.fulfill({ json: {
    source: 'liara-api', accountId: 'fixture-owner', fetchedAt: new Date().toISOString(), endpoints: ['/v1/me', '/v1/networks'],
    plans: [{ id: 'small-g2', region: 'iran', ramGB: 2, cpuCores: 1, diskGB: 10, hourlyPriceRaw: 999, monthlyHardwareFromCLI: 719280, baseBundle: 'basic', baseBundleDisplayPrice: 12345 }],
    networks: [{ id: 'fixture-net', name: 'شبکهٔ آزمایشی' }], costTotalKnown: false,
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: /استقرار وب‌سایت/ }).click();
  await expect(page.getByRole('region', { name: 'راهنمای استقرار دستی' })).toBeVisible();
  await page.locator('#project-zip').setInputFiles({ name: 'website.zip', mimeType: 'application/zip', buffer: makeTestZip(['package.json', 'vite.config.ts', 'index.html']) });
  await expect(page.getByText(/۳ کیلوبایت|۰ کیلوبایت|کیلوبایت/)).toBeVisible();
  await page.getByRole('button', { name: 'مرحلهٔ بعد' }).click();
  await expect(page.getByText('احتمالاً Vite / Node.js')).toBeVisible();
  await page.getByLabel('نوع اجرا برای بازبینی در کنسول').selectOption('node');
  await page.getByRole('button', { name: 'مرحلهٔ بعد' }).click();
  await page.getByRole('button', { name: 'خواندن پلن‌ها و شبکه‌های واقعی' }).click();
  await expect(page.getByLabel('پلن')).toHaveValue('small-g2');
  await page.getByLabel('شبکهٔ موجود').selectOption('fixture-net');
  await page.getByText('این یعنی چه؟').first().click();
  await page.getByRole('button', { name: 'از دستیار دربارهٔ این گزینه بپرسید' }).first().click();
  await expect(page.getByRole('textbox', { name: 'درخواست خود را بنویسید' })).toContainText('برای پروژهٔ من');
  await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'استقرار' }).click();
  await page.getByRole('button', { name: 'مرحلهٔ بعد' }).click();
  await expect(page.getByText('شبکهٔ آزمایشی')).toBeVisible();
  await expect(page.getByText('مبلغ نهایی نامشخص؛ در کنسول بررسی شود')).toBeVisible();
  await expect(page.getByRole('link', { name: 'باز کردن کنسول لیارا' })).toHaveAttribute('href', 'https://console.liara.ir/');
  await page.getByRole('button', { name: 'پس از انتشار، بررسی سلامت' }).click();
  await expect(page.getByRole('heading', { name: 'از وضعیت واقعی برنامه باخبر شو' })).toBeVisible();
  expect(seen.filter(value => value.startsWith('POST '))).toEqual(['POST /api/liara/test-options']);
});
test('mobile RTL navigation and guide stay within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('navigation', { name: 'ناوبری موبایل' })).toBeVisible();
  await page.getByRole('navigation', { name: 'ناوبری موبایل' }).getByRole('button', { name: 'استقرار' }).click();
  await expect(page.getByRole('heading', { name: 'وب‌سایتت را با اطمینان منتشر کن' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const section of ['سلامت', 'عیب‌یابی', 'عملیات', 'دستیار']) {
    await page.getByRole('navigation', { name: 'ناوبری موبایل' }).getByRole('button', { name: section }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: /بررسی سلامت دیدن وضعیت واقعی/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'از وضعیت واقعی برنامه باخبر شو' })).toBeVisible();
});

test('MOCK RUNTIME: first message connects automatically and sends once; failed connection preserves draft',async({page})=>{
 let connects=0,chats=0,fail=true;
 await page.route('**/api/status',route=>route.fulfill({json:{codex:{state:'disconnected',message:'fixture',verifiedConversation:false}}}));
 await page.route('**/api/connect',route=>{connects++;return route.fulfill({json:{codex:{state:fail?'error':'ready',message:fail?'اتصال آزمایشی ناموفق':'آماده',verifiedConversation:false}}});});
 await page.route('**/api/chat',route=>{chats++;return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'message',itemId:'fixture',text:'پاسخ آزمایشی'})+'\n\ndata: '+JSON.stringify({type:'done',status:'completed'})+'\n\n'});});
 await page.goto('/');const input=page.getByLabel('درخواست خود را بنویسید');await input.fill('راهنمایی کن');await page.getByRole('button',{name:'ارسال پیام'}).click();
 await expect(page.getByRole('alert')).toContainText('اتصال آزمایشی ناموفق');await expect(input).toHaveValue('راهنمایی کن');expect(chats).toBe(0);
 fail=false;await page.getByRole('button',{name:'ارسال پیام'}).click();await expect(page.locator('.message.assistant p')).toHaveText('پاسخ آزمایشی');expect(connects).toBe(2);expect(chats).toBe(1);
});

test('MOCK EVIDENCE: demo startup recovers from missing evidence without an endless loader',async({page})=>{
 let reads=0;
 await page.route('**/api/demo/live-check',route=>route.fulfill({json:{source:'live-http',checkedAt:new Date().toISOString(),results:[{path:'/',status:null},{path:'/health',status:200},{path:'/api/checkout',status:200}]}}));
 await page.route('**/api/demo/history',route=>{reads++;return reads===1?route.fulfill({status:500,json:{error:'missing'}}):route.fulfill({json:{historical:true,appId:'liara-test-k',releaseId:'fixture',fetchedAt:new Date().toISOString(),sourceMatch:true,events:[]}});});
 await page.goto('/');await page.getByRole('button',{name:'شروع دموی تعمیر'}).click();await expect(page.getByRole('button',{name:'بررسی دوبارهٔ فایل‌های دمو'})).toBeVisible();
 await expect(page.getByText('در حال خواندن شواهد تاریخی ثبت‌شده…')).toHaveCount(0);await expect(page.getByText('پاسخ بعضی مسیرها دریافت نشد؛ سلامت آن‌ها تأیید نشده است.')).toBeVisible();
 await page.getByRole('button',{name:'بررسی دوبارهٔ فایل‌های دمو'}).click();await expect(page.getByText('تأیید شد',{exact:true})).toBeVisible();expect(reads).toBe(2);
});
