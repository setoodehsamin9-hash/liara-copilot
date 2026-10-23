import { ErrorNotice } from './ErrorNotice.js';
import { useEffect,useRef,useState } from 'react';
import { request } from './api.js';
import type { SourceCandidate,SourceAssociation } from '../server/source-types.js';
export function SourcePanel({appId,disabled}:{appId:string|undefined;disabled:boolean}) {
  const [candidates,setCandidates]=useState<SourceCandidate[]>([]);const [source,setSource]=useState<SourceAssociation|null>(null);
  const [candidate,setCandidate]=useState('');const [github,setGithub]=useState('');const [consent,setConsent]=useState(false);const [pending,setPending]=useState(false);const [error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{
    generation.current++;setPending(false);setSource(null);setCandidates([]);setCandidate('');setConsent(false);setError('');
    if(!appId)return;const abort=new AbortController();
    void Promise.all([request<SourceCandidate[]>('/api/sources/candidates','GET',undefined,abort.signal),request<SourceAssociation|null>('/api/sources/current','GET',undefined,abort.signal)]).then(([list,current])=>{if(!abort.signal.aborted){setCandidates(list);setSource(current);}}).catch(e=>{if(!abort.signal.aborted)setError((e as Error).message);});
    return()=>abort.abort();
  },[appId]);
  async function associate(kind:'local'|'github') {
    if(!appId||!consent||disabled||pending)return;const operation=generation.current;setPending(true);setError('');
    try{const parts=github.trim().split('/');if(kind==='github'&&parts.length!==2)throw new Error('شناسه را به صورت owner/repository وارد کنید.');
      const result=await request<SourceAssociation>(`/api/sources/${kind}`,'POST',kind==='local'?{candidateId:candidate,consent:true}:{owner:parts[0],repo:parts[1],consent:true});
      if(operation===generation.current){setSource(result);setConsent(false);}
    }catch(e){if(operation===generation.current)setError((e as Error).message);}finally{if(operation===generation.current)setPending(false);}
  }
  async function disconnect(){
    if(disabled||pending)return;const operation=generation.current;setPending(true);setError('');
    try{await request('/api/sources/disconnect','POST',{});if(operation===generation.current)setSource(null);}
    catch(e){if(operation===generation.current)setError((e as Error).message);}
    finally{if(operation===generation.current)setPending(false);}
  }
  return <section className="liara-card phase3-card" aria-label="اتصال مخزن"><h2>مخزن کد برنامه</h2><p>این اتصال ابتدا اطلاعات نسخه را می‌خواند. خواندن سورس و تعمیر نسخهٔ جدا، به اجازهٔ مستقل شما در بخش تعمیر نیاز دارد.</p>
    {!appId?<p>ابتدا برنامه و شواهد لیارا را انتخاب کنید.</p>:<>
      <label><input type="checkbox" checked={consent} disabled={disabled||pending} onChange={e=>setConsent(e.target.checked)}/> اجازهٔ اتصال مخزن به <bdi>{appId}</bdi> و خواندن اطلاعات نسخه</label>
      {candidates.length?<div className="source-controls"><label>پروژهٔ مجاز محلی<select value={candidate} disabled={disabled||pending} onChange={e=>setCandidate(e.target.value)}><option value="">انتخاب پروژه</option>{candidates.map(row=><option value={row.id} key={row.id}>{row.label}</option>)}</select></label><button className="button secondary" disabled={!candidate||!consent||disabled||pending} onClick={()=>void associate('local')}>اتصال پروژهٔ محلی</button></div>:<p>پوشهٔ مجاز محلی تنظیم نشده است؛ راهنمای LIARA_SOURCE_ROOTS در README را ببینید.</p>}
      <div className="source-controls"><label>مخزن GitHub<input dir="ltr" value={github} maxLength={140} placeholder="owner/repository" disabled={disabled||pending} onChange={e=>setGithub(e.target.value)}/></label><button className="button secondary" disabled={!github.trim()||!consent||disabled||pending} onClick={()=>void associate('github')}>اتصال GitHub</button></div>
      {source&&<div><strong><bdi>{source.label}</bdi></strong><p dir="ltr">{source.branch??'detached HEAD'} · {source.revision??'بدون commit'}</p><small>اطلاعات نسخه · {source.fetchedAt}</small><button className="button secondary" disabled={disabled||pending} onClick={()=>void disconnect()}>قطع اتصال مخزن</button></div>}
    </>}{pending&&<p role="status">در حال خواندن اطلاعات مخزن…</p>}{error&&<ErrorNotice message={error} guidance="برنامهٔ انتخابی، اجازهٔ اتصال و شناسهٔ مخزن را بررسی کنید."/>}
  </section>;
}
