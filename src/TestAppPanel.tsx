import { ErrorNotice } from './ErrorNotice.js';
import {useEffect,useState} from 'react';
import {request} from './api.js';
import {displayTime} from './LiaraPanel.js';
import type {TestAppOptions} from '../server/test-app-options.js';
export function TestAppPanel({disabled,onBusy}:{disabled:boolean;onBusy:(value:boolean)=>void}){
 const [options,setOptions]=useState<TestAppOptions|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!options)return;const timer=setTimeout(()=>{setOptions(null);setError('اطلاعات پلن و شبکه منقضی شد؛ دوباره فقط‌خواندنی بررسی کنید.');},Math.max(0,300000-(Date.now()-Date.parse(options.fetchedAt))));return()=>clearTimeout(timer);},[options]);
 async function inspect(){if(pending||disabled)return;setPending(true);onBusy(true);setError('');setOptions(null);try{setOptions(await request<TestAppOptions>('/api/liara/test-options','POST',{}));}catch(e){setError((e as Error).message);}finally{setPending(false);onBusy(false);}}
 return <section className="phase3-card" aria-label="برنامه آزمایشی"><details><summary>آماده‌سازی برنامهٔ آزمایشی — فقط خواندنی</summary>
  <p>فقط پلن‌ها و شبکه‌های موجود حساب متصل خوانده می‌شوند. ساخت برنامه و هر استقرار، تأیید جداگانه می‌خواهند.</p>
  <button className="button secondary" disabled={disabled||pending} onClick={()=>void inspect()}>{pending?'در حال بررسی…':'خواندن پلن‌ها و شبکه‌های مجاز'}</button>
  {error&&<ErrorNotice message={error} guidance="اتصال لیارا را بررسی کنید و اطلاعات پلن و شبکه را دوباره بخوانید."/>}
  {options&&<><p>منبع: API واقعی لیارا · {displayTime(options.fetchedAt)}</p><p>هزینهٔ نهایی شامل مالیات و هزینه‌های جانبی معلوم نیست؛ اعداد کاتالوگ تأیید پرداخت یا سقف هزینه نیستند.</p>
   <p>محدوده: {options.scope?.kind==='team'?'تیم':'شخصی'} {options.scope?.kind==='team'&&<bdi>{options.scope.teamId}</bdi>}</p>{options.billing&&<p>موجودی خام API: <bdi>{options.billing.balanceRaw??'نامشخص'}</bdi>؛ واحد در قرارداد API مشخص نشده است. این عدد تضمین هزینه یا مجوز پرداخت نیست.</p>}
   {!options.plans.length&&<p>پلن پولی سازگار با شرایط بررسی‌شده پیدا نشد؛ هیچ برنامه‌ای ساخته نشد.</p>}
   {options.plans.map(plan=><details key={plan.id}><summary><bdi>{plan.id}</bdi> · RAM: <bdi>{plan.ramGB} GB</bdi> · CPU: <bdi>{plan.cpuCores}</bdi> · ایران</summary><p>فضای دیسک: <bdi>{plan.diskGB} GB</bdi></p><p>مقدار خام قیمت پلن: <bdi>{plan.hourlyPriceRaw}</bdi>؛ نمایش ماهانهٔ بستهٔ پایه: <bdi>{plan.baseBundleDisplayPrice}</bdi> تومان. این دو عدد بدون قرارداد روشن جمع نمی‌شوند.</p></details>)}
   <p>شبکهٔ موجود باید پیش از ساخت دقیقاً انتخاب شود:</p>{options.networks.map(network=><p key={network.id}>{network.name} · <bdi>{network.id}</bdi></p>)}{!options.networks.length&&<p>شبکه‌ای برنگشت؛ ساخت شبکه هم تأیید مستقل می‌خواهد.</p>}
  </>}
 </details></section>;
}
