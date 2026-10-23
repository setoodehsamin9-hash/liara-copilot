import { ErrorNotice } from './ErrorNotice.js';
import {useCallback,useEffect,useState} from 'react';
import {request} from './api.js';
import {displayTime} from './LiaraPanel.js';
import type {OperationSummary,OperationView} from '../server/operations.js';
const labels:Record<OperationView['state'],string>={pending:'در انتظار تأیید انسانی',running:'در حال اجرا — ارسال دوباره ممنوع',uncertain:'نامشخص — بررسی لازم است',completed:'انتشار ثبت شده',confirmed:'انتشار تأیید شده',failed:'ناموفق — برای اقدام بعدی تأیید تازه لازم است',rejected:'رد شده',invalidated:'مجوز قبلی باطل شده',expired:'مهلت تأیید تمام شده'};
export function OperationsPanel({disabled,onBusy}:{disabled:boolean;onBusy:(value:boolean)=>void}){
 const [items,setItems]=useState<OperationSummary[]>([]),[loading,setLoading]=useState(true),[pending,setPending]=useState(''),[error,setError]=useState('');
 const refresh=useCallback(async()=>{setItems(await request<OperationSummary[]>('/api/operations'));setLoading(false);},[]);
 useEffect(()=>{let live=true;const read=()=>{void request<OperationSummary[]>('/api/operations').then(rows=>{if(live){setItems(rows);setLoading(false);}}).catch(()=>{if(live){setError('سوابق دریافت نشد؛ اتصال محلی را بررسی کنید.');setLoading(false);}});};read();const timer=setInterval(read,8000);return()=>{live=false;clearInterval(timer);};},[]);
 async function act(item:OperationSummary,kind:'reconcile'|'reject'){
  if(disabled||pending)return;setPending(item.id);setError('');onBusy(true);
  try{
   if(kind==='reconcile')await request(`/api/operations/${item.id}/reconcile`,'POST',{});
   else{const view=await request<OperationView>(`/api/operations/${item.id}/review`);if(view.state!=='pending'||!view.reviewNonce)throw new Error('این مجوز دیگر معتبر نیست.');await request(`/api/operations/${item.id}/decision`,'POST',{decision:'reject',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true});}
   await refresh();
  }catch(e){setError((e as Error).message);}finally{setPending('');onBusy(false);}
 }
 return <section className="phase3-card operations-card" aria-label="پیگیری عملیات"><h2>پیگیری و بازیابی عملیات</h2>
  <p>قطع ارتباط به معنی شکست نیست. بررسی وضعیت فقط اطلاعات را می‌خواند و هیچ استقرار یا ارسال دوباره‌ای انجام نمی‌دهد.</p>
  <button className="button secondary" disabled={disabled||!!pending} onClick={()=>{setError('');void refresh().catch(()=>setError('سوابق دریافت نشد.'));}}>تازه‌سازی سوابق محلی</button>
  {loading&&<p role="status">در حال دریافت سوابق…</p>}{error&&<ErrorNotice message={error} guidance="اتصال محلی را بررسی کنید. عملیات نامشخص را دوباره ارسال نکنید."/>}
  {!loading&&!items.length&&<p>هنوز عملیاتی ثبت نشده است.</p>}
  {items.map(item=><article className="operation-record" key={item.id}><h3><bdi>{item.target.appId}</bdi></h3><strong>{labels[item.state]}</strong>
   <p>{item.fixture===true?'سناریوی آزمایشی API — نتیجهٔ استقرار واقعی نیست.':item.fixture===false?'عملیات حساب واقعی لیارا':'ثبت قدیمی؛ نوع عملیات قابل احراز نیست.'}</p>
   {!item.metadataAvailable&&<p>فرادادهٔ این ثبت قدیمی کامل نیست. بررسی دستی در کنسول لیارا لازم است؛ مجوز قبلی قابل استفاده نیست.</p>}
   {item.recovery?.state==='pending'&&<p>انتشار هنوز در انتظار تکمیل است؛ بعداً فقط وضعیت را دوباره بررسی کنید.</p>}
   {item.recovery?.state==='manual'&&<p role="status">تطبیق قطعی ممکن نشد؛ هدف قفل می‌ماند. شناسه‌ها و وضعیت را در کنسول لیارا یا با پشتیبانی بررسی کنید. قفل یا مجوز را برای تکرار عملیات دور نزنید.</p>}
   {(item.recovery?.httpHealth??item.outcome?.httpHealth)==='not_configured'&&<p>بررسی HTTP تنظیم نشده است؛ سلامت وب‌سایت تأیید نشده.</p>}
   {(item.recovery?.httpHealth??item.outcome?.httpHealth)==='passed'&&<p>بررسی HTTP در زمان ثبت‌شده پاسخ ۲۰۰ داد.</p>}
   {item.recovery?.httpHealth==='failed'&&<p className="error-message">انتشار فعال است، اما بررسی HTTP موفق نشد؛ استقرار خودکار تکرار نمی‌شود.</p>}
   {item.recovery&&<p>آخرین بررسی: {displayTime(item.recovery.checkedAt)}</p>}
   {!item.recovery&&item.outcome&&<p>نتیجهٔ ثبت‌شده در {displayTime(item.outcome.fetchedAt)}؛ برای وضعیت تازه دوباره فقط‌خواندنی بررسی کنید.</p>}
   <details><summary>شناسه‌ها و شواهد بررسی</summary><p dir="ltr">{item.id}<br/>{item.revision}<br/>{item.artifactDigest}<br/>source: {item.sourceID??'unknown'} · release: {item.releaseID??'unknown'}</p>{item.recovery?.evidence.map((e,index)=><p key={index}><bdi>{e.endpoint}</bdi> · {displayTime(e.fetchedAt)}</p>)}</details>
   {item.canReconcile&&<button className="button secondary" disabled={disabled||!!pending} onClick={()=>void act(item,'reconcile')}>{pending===item.id?'در حال بررسی…':'بررسی فقط‌خواندنی وضعیت'}</button>}
   {item.state==='pending'&&item.metadataAvailable&&<button className="button secondary" disabled={disabled||!!pending} onClick={()=>void act(item,'reject')}>رد پیشنهاد معلق</button>}
  </article>)}
 </section>;
}
