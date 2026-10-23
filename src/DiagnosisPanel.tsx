import { ErrorNotice } from './ErrorNotice.js';
import { useEffect, useRef, useState } from 'react';
import { stream } from './api.js';
import type { DiagnosisEvent,DiagnosisReport } from '../server/diagnosis.js';
import type { EvidenceSelection } from './LiaraPanel.js';
import { displayTime } from './LiaraPanel.js';

const problems=[['http500','خطای ۵۰۰'],['crash','توقف برنامه'],['slow','کندی سایت'],['resources','CPU و حافظه']] as const;
export function DiagnosisPanel({evidence,ready,busy,onBusy}:{evidence:EvidenceSelection|null;ready:boolean;busy:boolean;onBusy:(value:boolean)=>void}) {
  const [consent,setConsent]=useState(false);const [report,setReport]=useState<DiagnosisReport|null>(null);
  const [progress,setProgress]=useState('');const [error,setError]=useState('');const abort=useRef<AbortController|null>(null);
  useEffect(()=>{setConsent(false);setReport(null);setError('');setProgress('');},[evidence?.id]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function diagnose(problem:string) {
    if(!evidence||!consent||!ready||busy)return;
    const controller=new AbortController();abort.current=controller;onBusy(true);setReport(null);setError('');setProgress('در حال ارسال شواهد…');
    try{await stream<DiagnosisEvent>('/api/diagnosis',{problem,evidenceId:evidence.id,consent:true},event=>{
      if(event.type==='progress')setProgress(event.message);
      if(event.type==='result')setReport(event.report);
      if(event.type==='error')setError(event.message);
      if(event.type==='done')setProgress(event.status==='completed'?'بررسی اولیه آماده شد.':'بررسی کامل نشد.');
    },controller.signal);}catch(e){setError(controller.signal.aborted?'بررسی متوقف شد. اتصال Codex را دوباره بررسی کنید.':(e as Error).message);}
    finally{abort.current=null;onBusy(false);}
  }
  return <section className="liara-card phase3-card" aria-label="عیب‌یابی اولیه"><h2>عیب‌یابی اولیه با شواهد</h2><p>نتیجه، فرضیهٔ هوش مصنوعی است و علت قطعی تأییدشده نیست. هیچ تغییری انجام نمی‌شود.</p>
    {!evidence?<p>ابتدا یک برنامهٔ لیارا را انتخاب و شواهد آن را دریافت کنید.</p>:<label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> اجازهٔ ارسال همین شواهد پاک‌سازی‌شده به Codex برای این بررسی · <bdi>{evidence.appId}</bdi></label>}
    <div className="quick-actions">{problems.map(([key,label])=><button className="button secondary" key={key} disabled={!evidence||!consent||!ready||busy} onClick={()=>void diagnose(key)}>{label}</button>)}</div>
    {!ready&&<small>ابتدا گفت‌وگوی Codex را متصل کنید.</small>}<p role="status">{progress}</p>{error&&<ErrorNotice message={error} guidance="شواهد تازه و اتصال دستیار را بررسی کنید؛ این درخواست تغییری در برنامه نمی‌دهد."/>}
    {report&&<article className="diagnosis-report"><strong>فرضیهٔ اولیه · نیازمند بررسی انسانی</strong><h3>{report.summary}</h3><small><bdi>{report.appId}</bdi> · {displayTime(report.analyzedAt)}</small>
      <h3>علت‌های احتمالی</h3>{report.likelyCauses.length===0?<p>شواهد برای پیشنهاد علت کافی نیست.</p>:<ul>{report.likelyCauses.map((cause,index)=><li key={index}>{cause.cause} · اطمینان {cause.confidence==='low'?'کم':'متوسط'} · منابع: {cause.evidenceIds.join('، ')}</li>)}</ul>}
      <h3>قدم‌های پیشنهادی</h3><ul>{report.recommendedActions.map((value,index)=><li key={index}>{value}</li>)}</ul><h3>اطلاعات موردنیاز</h3><ul>{report.missingInformation.map((value,index)=><li key={index}>{value}</li>)}</ul>
      <details><summary>منابع و زمان شواهد</summary>{report.evidence.map(row=><p key={row.id}><bdi>{row.id} · {row.state} · {row.endpoint}</bdi><br/>دریافت: {displayTime(row.fetchedAt)}{row.timestamps.map((value,index)=><small key={index}> · {displayTime(value)}</small>)}</p>)}</details>
    </article>}
  </section>;
}
