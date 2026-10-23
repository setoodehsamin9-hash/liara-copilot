import { ErrorNotice } from './ErrorNotice.js';
import {useEffect,useRef,useState} from 'react';
import {request,stream,download} from './api.js';
import {displayTime} from './LiaraPanel.js';
import type {RepairView,RepairEvent} from '../server/repair-types.js';
import type {OperationView} from '../server/operations.js';

export function RepairPanel({appId,disabled,onBusy,demoMode=false}:{appId:string|undefined;disabled:boolean;onBusy:(value:boolean)=>void;demoMode?:boolean}){
 const [source,setSource]=useState<'fixture'|'selected'|'checkout-baseline'>(demoMode?'checkout-baseline':'fixture'),[consent,setConsent]=useState(false),[fixConsent,setFixConsent]=useState(false),[reviewed,setReviewed]=useState(false),[ack,setAck]=useState(false);
 const [repair,setRepair]=useState<RepairView|null>(null),[operation,setOperation]=useState<OperationView|null>(null);
 const [pending,setPending]=useState(''),[progress,setProgress]=useState(''),[error,setError]=useState(''),[zipHash,setZipHash]=useState<string|null>(null),[port,setPort]=useState(3000),[scenario,setScenario]=useState('success');
 const abort=useRef<AbortController|null>(null);
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{if(!pending){setElapsed(0);return;}const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[pending]);
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function perform(kind:string,work:()=>Promise<void>){
  if(disabled||pending)return;setPending(kind);onBusy(true);setError('');
  try{await work();}catch(e){setError((e as Error).message);}finally{setPending('');onBusy(false);abort.current=null;}
 }
 async function analyze(){await perform('analyze',async()=>{
  setRepair(null);setZipHash(null);setOperation(null);setReviewed(false);setFixConsent(false);setAck(false);setProgress('خواندن نسخهٔ مجاز، ساخت فضای جدا و اجرای آزمون اولیه…');
  const result=await request<RepairView>('/api/repairs','POST',{source,consent:true});setRepair(result);setProgress('بررسی اولیه و نتیجهٔ واقعی آزمون آماده است.');
 });}
 async function fix(){if(!repair||!fixConsent)return;await perform('fix',async()=>{
  const controller=new AbortController();abort.current=controller;setProgress('در حال اتصال به موتور تعمیر Codex…');
  await stream<RepairEvent>(`/api/repairs/${repair.id}/fix`,{consent:true},event=>{
   if(event.type==='progress')setProgress(event.message);
   if(event.type==='result')setRepair(event.repair);
   if(event.type==='error')setError(event.message);
   if(event.type==='done')setProgress(event.status==='completed'?'آزمون‌های واقعی گذشتند؛ تغییرات آمادهٔ بازبینی شما هستند.':'تعمیر تأیید نشد. نتیجهٔ آزمون‌ها را بررسی کنید.');
  },controller.signal);
 });}
 async function proposal(){if(!repair||!reviewed)return;await perform('proposal',async()=>{setAck(false);setOperation(await request<OperationView>(`/api/repairs/${repair.id}/proposal`,'POST',{reviewed:true,port,...(repair.fixture?{scenario}:{})}));});}
 async function decide(decision:'approve'|'reject'){if(!operation)return;await perform('decision',async()=>{setOperation(await request<OperationView>(`/api/operations/${operation.id}/decision`,'POST',{decision,digest:operation.digest,reviewNonce:operation.reviewNonce,acknowledge:true}));setAck(false);});}
 return <section className="phase3-card repair-card" aria-label="تعمیر و بازبینی"><h2>تعمیر با کنترل شما</h2><p>بررسی ← تعمیر در نسخهٔ جدا ← آزمون واقعی ← بازبینی انسانی</p>
  <div className="source-controls"><label>منبع بررسی<select value={source} disabled={disabled||!!pending} onChange={e=>{setSource(e.target.value as 'fixture'|'selected'|'checkout-baseline');setConsent(false);}}><option value="checkout-baseline">baseline تاریخی v1 برنامهٔ liara-test-k · محلی</option><option value="fixture">وب‌سایت آزمایشی عمومی HTTP 500 — بدون لیارا</option><option value="selected" disabled={!appId}>مخزن مجاز برنامهٔ انتخابی {appId??''}</option></select></label></div>
  <label><input type="checkbox" checked={consent} disabled={disabled||!!pending} onChange={e=>setConsent(e.target.checked)}/> اجازهٔ خواندن سورس انتخابی و ساخت نسخهٔ جدا برای بررسی؛ checkout اصلی تغییر نمی‌کند.</label>
  <button className="button secondary" disabled={!consent||disabled||!!pending||(source==='selected'&&!appId)} onClick={()=>void analyze()}>۱. بررسی و ساخت فضای تعمیر</button>
  <p role="status">{progress}{pending&&<small className="repair-elapsed"> · {elapsed.toLocaleString('fa-IR')} ثانیه سپری شده؛ صفحه را باز نگه دارید.</small>}</p>{error&&<ErrorNotice message={error} guidance="وضعیت سورس و آزمون‌های محلی را بررسی کنید؛ تعمیر در نسخهٔ جدا انجام می‌شود."/>}
  {repair&&<article><h3>{repair.label}</h3>{repair.fixture&&<strong className="fixture-label">{repair.checkoutBaseline?'baseline محلیِ منطبق با آرشیو دانلودی v1 · اجرای واقعی محلی · وضعیت کنونی ابر جداگانه بررسی می‌شود':'پروژهٔ آزمایشی جدا · نتیجهٔ واقعی اجرای محلی · بدون برنامهٔ ابری'}</strong>}
   <p>آزمون اولیه: {repair.beforeTests.exitCode===0?'گذشت':'ناموفق — نیازمند بررسی'}{repair.beforeHttp&&<> · HTTP اولیه: <bdi>{repair.beforeHttp.status}</bdi></>}</p>
   {repair.state==='analyzed'&&<><label><input type="checkbox" checked={fixConsent} disabled={disabled||!!pending} onChange={e=>setFixConsent(e.target.checked)}/> اجازه می‌دهم Codex فقط در فضای تعمیر جدا فایل‌های مجاز را ویرایش و آزمون‌های محدود را اجرا کند.</label><button className="button primary" disabled={!fixConsent||disabled||!!pending} onClick={()=>void fix()}>۲. تعمیر با Codex و اجرای آزمون</button></>}
   {pending==='fix'&&<button className="button secondary" onClick={()=>abort.current?.abort()}>توقف تعمیر</button>}
   {repair.afterTests&&<p>آزمون نهایی: {repair.afterTests.exitCode===0?'گذشت':'ناموفق؛ تعمیر تأیید نشده'}{repair.afterHttp&&<> · HTTP نهایی: <bdi>{repair.afterHttp.status}</bdi></>}</p>}
   {repair.regressionBefore&&<p>آزمون رگرسیون تازه روی نسخهٔ قبل: {repair.regressionBefore.exitCode===1?'شکست خورد؛ خطای قبلی را بازتولید کرد':'خطای قبلی را ثابت نکرد'}</p>}
   {repair.state==='failed'&&<p className="error-message">{repair.error}</p>}
   <p dir="auto">{repair.summary}</p>
   <details><summary>جزئیات فنی، فایل‌ها و آزمون‌ها</summary><p dir="ltr">{repair.branch}<br/>{repair.revision??repair.sourceRevision}</p><ul>{repair.files.map(path=><li key={path}><bdi>{path}</bdi></li>)}</ul><pre dir="ltr">{repair.beforeTests.command+'\n'+repair.beforeTests.stdout+repair.beforeTests.stderr}</pre>{repair.afterTests&&<pre dir="ltr">{repair.afterTests.command+'\n'+repair.afterTests.stdout+repair.afterTests.stderr}</pre>}</details>
   {repair.diff&&<details open><summary>۳. مشاهدهٔ تغییرات واقعی</summary>{repair.changedFiles&&<ul>{repair.changedFiles.map(path=><li key={path}><bdi>{path}</bdi></li>)}</ul>}<pre className="repair-diff" dir="ltr">{repair.diff}</pre></details>}
   {repair.state==='review'&&<div className="manual-notice"><strong>بستهٔ تعمیرشدهٔ همین اجرای Codex</strong><p>پس از بازبینی diff و آزمون‌ها، ZIP را دریافت کنید. این دانلود هیچ استقراری انجام نمی‌دهد.</p><button className="button primary" disabled={disabled||!!pending} onClick={()=>void perform('zip',async()=>setZipHash(await download(`/api/repairs/${repair.id}/zip`,'liara-checkout-repaired.zip')))}>دریافت ZIP تعمیرشده</button>{zipHash&&<p>SHA-256 فایل دریافت‌شده: <bdi>{zipHash}</bdi></p>}</div>}
   {repair.state==='review'&&!operation&&(repair.fixture&&!repair.checkoutBaseline ? <><label><input type="checkbox" checked={reviewed} disabled={disabled||!!pending} onChange={e=>setReviewed(e.target.checked)}/> تغییرات و نتیجهٔ آزمون‌ها را خواندم؛ آماده‌سازی پیشنهاد آزمایشی را می‌خواهم.</label><div className="source-controls"><label>پورت برنامه<input type="number" min={1} max={65535} value={port} disabled={disabled||!!pending} onChange={e=>setPort(Number(e.target.value))}/></label><label>سناریوی استقرار آزمایشی<select value={scenario} disabled={disabled||!!pending} onChange={e=>setScenario(e.target.value)}><option value="success">پاسخ موفق مصنوعی API</option><option value="upload_uncertain">قطع ارتباط مبهم هنگام ارسال</option><option value="release_failed">شکست انتشار</option><option value="release_response_lost">گم‌شدن پاسخ ایجاد انتشار</option></select></label></div><button className="button secondary" disabled={!reviewed||disabled||!!pending} onClick={()=>void proposal()}>آماده‌سازی پیشنهاد آزمایشی</button></> : <div className="manual-notice"><strong>تغییرات محلی آمادهٔ بازبینی‌اند</strong><p>diff و آزمون‌های همین نسخه را بررسی کنید. مسیر استقرار خودکار برای برنامهٔ واقعی در این رابط ارائه نمی‌شود؛ انتشار بعدی، در صورت تصمیم شما، باید به‌صورت دستی در کنسول لیارا و با تأیید جداگانه انجام شود.</p></div>)}
  </article>}
  {operation&&<article className="human-review" aria-label="تأیید انسانی"><h3>{operation.fixture?'پیشنهاد آزمایشی — بدون درخواست واقعی به لیارا':'پیشنهاد استقرار واقعی'}</h3><p>{operation.impact}</p><p>برنامه: <bdi>{operation.target.appId}</bdi> · پورت: <bdi>{operation.parameters.port}</bdi></p><p>انقضا: {displayTime(new Date(operation.expires).toISOString())}</p><details><summary>نسخه و بستهٔ دقیق مورد تأیید</summary><p dir="ltr">{operation.revision}<br/>{operation.artifactDigest}<br/>{operation.archiveBytes} bytes</p></details><ul>{operation.risks.map(risk=><li key={risk}>{risk}</li>)}</ul>
   {operation.state==='pending'&&<><label><input type="checkbox" checked={ack} disabled={disabled||!!pending} onChange={e=>setAck(e.target.checked)}/> هدف، تغییرات، آزمون‌ها و اثر این عملیات دقیق را بررسی کردم و اجرای همین پیشنهاد را تأیید می‌کنم.</label><div className="quick-actions"><button className="button primary" disabled={!ack||disabled||!!pending} onClick={()=>void decide('approve')}>{operation.fixture?'تأیید و اجرای سناریوی آزمایشی':'تأیید و شروع استقرار واقعی'}</button><button className="button secondary" disabled={disabled||!!pending} onClick={()=>void decide('reject')}>رد پیشنهاد</button></div></>}
   {operation.state==='completed'&&<p role="status">{operation.fixture?'سناریوی API آزمایشی کامل شد؛ این نتیجه، استقرار واقعی نیست.':'انتشار ثبت و وضعیت آن بررسی شد؛ نتیجهٔ بررسی HTTP را جداگانه ببینید.'}</p>}
   {operation.state==='rejected'&&<p>پیشنهاد رد شد؛ مجوز آن دیگر قابل استفاده نیست.</p>}
   {operation.state==='uncertain'&&<p role="alert">نتیجه نامشخص یا انتشار ناموفق است؛ عملیات خودکار تکرار نمی‌شود و این هدف تا بررسی وضعیت قفل است.</p>}
  </article>}
 </section>;
}
