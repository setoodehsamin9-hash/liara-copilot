import {test,expect} from '@playwright/test';
test('MOCK SCOPE: Persian selector clears personal catalog/evidence and verifies team without a cloud decision',async({page})=>{
 const teamId='000000000000000000000002';let selected=false,changes=0;
 const status=()=>({configured:true,state:'connected',scope:selected?{kind:'team',teamId}:{kind:'personal'},account:{id:selected?'owner:team:'+teamId:'owner',name:selected?'FIXTURE TEAM':'FIXTURE PERSONAL'},selectedApp:null,error:null,verifiedAt:new Date().toISOString()});
 await page.route('**/api/liara/status',r=>r.fulfill({json:status()}));await page.route('**/api/liara/apps',r=>r.fulfill({json:{source:'liara-api',data:[]}}));
 await page.route('**/api/liara/test-options',r=>r.fulfill({json:{source:'liara-api',accountId:status().account.id,fetchedAt:new Date().toISOString(),plans:[],networks:[{id:'personal-network',name:'PERSONAL_SCOPE_MARKER'}],costTotalKnown:false}}));
 await page.route('**/api/liara/scope',r=>{expect(r.request().postDataJSON()).toEqual({kind:'team',teamId});changes++;selected=true;return r.fulfill({json:status()});});
 await page.goto('/');await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'استقرار'}).click();await page.getByRole('button',{name:/۳ تنظیمات/}).click();await page.getByText('جزئیات بیشتر پلن، منطقه، ذخیره‌سازی و هزینه').click();const catalog=page.getByRole('region',{name:'برنامه آزمایشی'});await catalog.getByText('آماده‌سازی برنامهٔ آزمایشی — فقط خواندنی',{exact:true}).click();await catalog.getByRole('button',{name:'خواندن پلن‌ها و شبکه‌های مجاز'}).click();await expect(page.getByText(/PERSONAL_SCOPE_MARKER/)).toBeVisible();
 await page.getByRole('navigation',{name:'بخش‌ها'}).getByRole('button',{name:'سلامت'}).click();await page.getByLabel('محدودهٔ حساب لیارا').selectOption(teamId);await expect(page.getByText('FIXTURE TEAM')).toBeVisible();await expect(page.getByText(/PERSONAL_SCOPE_MARKER/)).toHaveCount(0);expect(changes).toBe(1);
});
