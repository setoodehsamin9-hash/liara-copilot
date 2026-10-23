import {test,expect} from '@playwright/test';
test('MOCKED HISTORY: Persian recovery survives reload and never offers a mutation retry',async({page})=>{
 let reconciled=false;const record={id:'00000000-0000-4000-8000-000000000005',state:'uncertain',fixture:true,target:{accountId:'fixture-owner',appId:'fixture-app'},revision:'sha256:fixture',artifactDigest:'sha256:archive',lastStep:'release_submitted',releaseID:'fixture-release',metadataAvailable:true,canReconcile:true};
 const proof={state:'confirmed',reason:'ready',checkedAt:'2026-10-22T00:00:00Z',releaseID:'fixture-release',httpHealth:'not_configured',evidence:[{endpoint:'/v1/releases/fixture-release',fetchedAt:'2026-10-22T00:00:00Z'}]};
 await page.route('**/api/operations',route=>route.fulfill({json:[{...record,...(reconciled?{state:'confirmed',recovery:proof}:{})}]}));
 await page.route('**/api/operations/*/reconcile',route=>{expect(route.request().postDataJSON()).toEqual({});reconciled=true;return route.fulfill({json:{...record,state:'confirmed',recovery:proof}});});
 await page.goto('/');await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'عملیات'}).click();const panel=page.getByRole('region',{name:'پیگیری عملیات'});
 await expect(panel.getByText('نامشخص — بررسی لازم است',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:/تکرار|استقرار|ارسال دوباره/})).toHaveCount(0);
 await panel.getByRole('button',{name:'بررسی فقط‌خواندنی وضعیت'}).click();await expect(panel.getByText('انتشار تأیید شده',{exact:true})).toBeVisible();
 await page.reload();await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'عملیات'}).click();await expect(panel.getByText('انتشار تأیید شده',{exact:true})).toBeVisible();await expect(panel.getByText('بررسی HTTP تنظیم نشده است؛ سلامت وب‌سایت تأیید نشده.')).toBeVisible();
});
test('MOCKED CATALOG: Liara disconnect clears previously fetched plan/network data',async({page})=>{
 const connected={configured:true,state:'connected',account:{id:'fixture-owner',name:'FIXTURE'},verifiedAt:new Date().toISOString(),selectedApp:null,error:null};
 await page.route('**/api/liara/status',route=>route.fulfill({json:connected}));await page.route('**/api/liara/apps',route=>route.fulfill({json:{source:'liara-api',data:[]}}));
 await page.route('**/api/liara/test-options',route=>route.fulfill({json:{source:'liara-api',accountId:'fixture-owner',fetchedAt:new Date().toISOString(),endpoints:['/v1/me','/v1/networks'],plans:[],networks:[{id:'fixture-network',name:'CATALOG_SCOPE_MARKER'}],costTotalKnown:false}}));
 await page.route('**/api/liara/disconnect',route=>route.fulfill({json:{...connected,state:'disconnected',account:null}}));
 await page.goto('/');await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'استقرار'}).click();await page.getByRole('button',{name:/۳ تنظیمات/}).click();await page.getByText('جزئیات بیشتر پلن، منطقه، ذخیره‌سازی و هزینه').click();const panel=page.getByRole('region',{name:'برنامه آزمایشی'});await panel.getByText('آماده‌سازی برنامهٔ آزمایشی — فقط خواندنی',{exact:true}).click();
 await panel.getByRole('button',{name:'خواندن پلن‌ها و شبکه‌های مجاز'}).click();await expect(panel.getByText(/CATALOG_SCOPE_MARKER/)).toBeVisible();
 await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'سلامت'}).click();await page.getByRole('button',{name:'قطع اتصال لیارا'}).click();await expect(panel.getByText(/CATALOG_SCOPE_MARKER/)).toHaveCount(0);
});
