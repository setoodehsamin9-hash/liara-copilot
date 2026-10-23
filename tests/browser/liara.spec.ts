import { test, expect } from '@playwright/test';

const timestamp = '2026-10-22T15:00:00.000Z';
const connected = { configured: true, state: 'connected', account: { id: 'owner', name: 'Fixture owner' }, verifiedAt: timestamp, selectedApp: null, error: null };
const evidence = <T>(endpoint: string, data: T) => ({ state: 'ok', evidence: { source: 'liara-api', endpoint, fetchedAt: timestamp, data } });
const snapshot = {
  id: '00000000-0000-4000-8000-000000000001', appId: 'fixture-app', fetchedAt: timestamp, window: { from: timestamp, to: timestamp },
  details: evidence('/v1/projects/fixture-app', { id: 'fixture-app', platform: 'node', status: 'running', deployed: true, scale: 1 }),
  logs: evidence('/v1/projects/fixture-app/logs', [{ timestamp, level: 'stderr', message: 'HTTP 500 password=[REDACTED]' }, { timestamp, level: 'stdout', message: 'request completed' }]),
  cpu: evidence('/v1/projects/fixture-app/metrics/cpu', [{ instance: 'instance-1', points: [{ x: 1, value: 0.25 }, { x: 2, value: 0.5 }] }]),
  memory: evidence('/v1/projects/fixture-app/metrics/memory', []),
  releases: { state: 'unsupported', code: 'not_found', message: 'در این برنامه در دسترس نیست.', endpoint: '/v1/projects/fixture-app/releases', fetchedAt: timestamp },
};

test('Liara missing credential state offers local hidden-input setup, never a browser token form', async ({ page }) => {
  await page.route('**/api/liara/status', r => r.fulfill({ json: { ...connected, configured: false, state: 'unconfigured', account: null } }));
  await page.goto('/'); await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'سلامت' }).click();
  await expect(page.getByRole('heading', { name: 'وضعیت وب‌سایت در لیارا' })).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('توکن لیارا تنظیم نشده است.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بررسی اتصال لیارا' })).toBeDisabled();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('TEST FIXTURE: app selection, raw charts, log search, unavailable data and evidence opt-in', async ({ page }) => {
  let selected = false;
  await page.route('**/api/liara/status', r => r.fulfill({ json: { ...connected, state: 'disconnected', account: null } }));
  await page.route('**/api/liara/connect', r => r.fulfill({ json: connected }));
  await page.route('**/api/liara/apps', r => r.fulfill({ json: { source: 'liara-api', fetchedAt: timestamp, endpoint: '/v1/projects', data: [{ id: 'fixture-app', platform: 'node', status: 'running' }] } }));
  await page.route('**/api/liara/selection', r => { selected = r.request().postDataJSON().appId === 'fixture-app'; return r.fulfill({ json: { ...connected, selectedApp: 'fixture-app' } }); });
  await page.route('**/api/liara/refresh', r => r.fulfill({ json: snapshot }));
  const codex = { state: 'ready', message: 'fixture', verifiedConversation: false };
  await page.route('**/api/status', r => r.fulfill({ json: { codex } }));
  await page.route('**/api/connect', r => r.fulfill({ json: { codex } }));
  let chatBody: Record<string, unknown> = {};
  await page.route('**/api/sources/candidates',r=>r.fulfill({json:[{id:'00000000-0000-4000-8000-000000000002',label:'LOCAL TEST FIXTURE'}]}));
  await page.route('**/api/sources/current',r=>r.fulfill({json:null}));
  await page.route('**/api/sources/local',r=>r.fulfill({json:{kind:'local',label:'LOCAL TEST FIXTURE',revision:'a'.repeat(40),branch:'main',fetchedAt:timestamp,access:'metadata-only'}}));
  let diagnosisBody:Record<string,unknown>={};
  await page.route('**/api/diagnosis',r=>{diagnosisBody=r.request().postDataJSON();return r.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({type:'result',report:{classification:'ai_hypothesis',appId:'fixture-app',analyzedAt:timestamp,summary:'فرضیهٔ آزمایشی خطای برنامه',likelyCauses:[{cause:'آزمایشی',confidence:'low',evidenceIds:['logs']}],recommendedActions:['بررسی دستی'],missingInformation:['کد برنامه'],evidence:[{id:'logs',state:'ok',endpoint:'/fixture/logs',fetchedAt:timestamp,timestamps:[timestamp]}]}})}\n\ndata: {"type":"done","status":"completed"}\n\n`});});
  await page.route('**/api/chat', r => { chatBody = r.request().postDataJSON(); return r.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"done","status":"completed"}\n\n' }); });
  await page.goto('/'); await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'سلامت' }).click();
  await page.getByRole('button', { name: 'بررسی اتصال لیارا' }).click();
  await page.getByRole('combobox', { name: 'برنامهٔ لیارا' }).selectOption('fixture-app');
  await expect(page.getByRole('figure', { name: 'CPU — دادهٔ خام لیارا' })).toBeVisible();
  expect(selected).toBe(true);
  await expect(page.getByText('داده‌ای برای RAM دریافت نشد.', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'جست‌وجو در لاگ‌ها' }).fill('500');
  await expect(page.getByText('HTTP 500 password=[REDACTED]', { exact: true })).toBeVisible();
  await expect(page.getByText('request completed', { exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'دستیار' }).click();
  await expect(page.getByRole('checkbox', { name: 'اشتراک شواهد پاک‌سازی‌شده با Codex' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'اشتراک شواهد پاک‌سازی‌شده با Codex' }).check();
  await page.getByRole('button', { name: 'گفت‌وگوی تازه', exact: true }).click();
  await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'عیب‌یابی' }).click();
  const diagnosis=page.getByRole('region',{name:'عیب‌یابی اولیه'});
  await expect(diagnosis.getByRole('button',{name:'خطای ۵۰۰'})).toBeDisabled();
  await diagnosis.getByRole('checkbox').check();
  await diagnosis.getByRole('button',{name:'خطای ۵۰۰'}).click();
  await expect(diagnosis.getByRole('heading',{name:'فرضیهٔ آزمایشی خطای برنامه'})).toBeVisible();
  expect(diagnosisBody).toEqual({problem:'http500',evidenceId:snapshot.id,consent:true});
  const sources=page.getByRole('region',{name:'اتصال مخزن'});
  await sources.getByRole('checkbox').check();
  await sources.getByRole('combobox',{name:'پروژهٔ مجاز محلی'}).selectOption('00000000-0000-4000-8000-000000000002');
  await sources.getByRole('button',{name:'اتصال پروژهٔ محلی'}).click();
  await expect(sources.getByText('LOCAL TEST FIXTURE',{exact:true})).toHaveCount(2);
  await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('button', { name: 'دستیار' }).click();
  await page.getByRole('textbox', { name: 'درخواست خود را بنویسید' }).fill('علت خطای سایت چیست؟');
  await page.getByRole('button', { name: 'ارسال پیام' }).click();
  await expect.poll(() => chatBody.evidenceId).toBe(snapshot.id);
  expect(Object.keys(chatBody).sort()).toEqual(['evidenceId','message']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
