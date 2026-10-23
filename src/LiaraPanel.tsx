import { ErrorNotice } from './ErrorNotice.js';
import { useEffect, useState } from 'react';
import { request } from './api.js';
import type { Evidence, LiaraApp, LiaraSnapshot, LiaraStatus, MetricSeries, ReadResult } from '../server/liara-types.js';
import {VERIFIED_TEAM_ID} from '../server/scope-constants.js';

export type EvidenceSelection = { id: string; appId: string; fetchedAt: string };
export function displayTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'medium' }).format(date) : value;
}
function Source({ value }: { value: { endpoint: string; fetchedAt: string } }) {
  return <div className="evidence-source">منبع: Liara API · دریافت: <time dateTime={value.fetchedAt}>{displayTime(value.fetchedAt)}</time><code dir="ltr">{value.endpoint}</code></div>;
}
function Failure({ result }: { result: { state: 'error' | 'unsupported'; message: string; endpoint: string; fetchedAt: string } }) {
  return <div className={result.state === 'error' ? 'section-error' : 'section-empty'}><p>{result.state === 'unsupported' ? 'این بخش پشتیبانی نمی‌شود یا در دسترس نیست.' : 'دریافت این بخش موفق نبود. اتصال را بررسی کنید و دوباره تازه‌سازی کنید.'}</p>{result.state === 'error' && <details><summary>جزئیات فنی</summary><span dir="auto">{result.message}</span></details>}<Source value={result}/></div>;
}
const colors = ['#24835b','#4678c4','#a66ab8','#c58b34'];
function MetricChart({ title, result }: { title: string; result: ReadResult<MetricSeries[]> }) {
  if (result.state !== 'ok') return <section className="metric-card"><h3>{title}</h3><Failure result={result}/></section>;
  const series = result.evidence.data.slice(0,8);
  const points = series.flatMap(row => row.points);
  const numeric = points.filter(point => point.value !== null);
  const minimum = Math.min(0, ...numeric.map(point => point.value!));
  const maximum = Math.max(0, ...numeric.map(point => point.value!));
  const range = maximum - minimum || 1;
  const first = Math.min(...points.map(point => point.x)); const last = Math.max(...points.map(point => point.x));
  const path = (row: MetricSeries) => {
    let pen = false;
    return row.points.map(point => {
      if (point.value === null) { pen = false; return ''; }
      const x = 12 + (point.x - first) / (last - first || 1) * 296;
      const y = 96 - (point.value - minimum) / range * 80;
      const move = pen ? 'L' : 'M'; pen = true; return `${move}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  };
  return <figure className="metric-card" aria-label={`${title} — دادهٔ خام لیارا`}>
    <figcaption><h3>{title}</h3><span>واحد خام API · بدون تبدیل</span></figcaption>
    {numeric.length === 0 ? <p className="section-empty">داده‌ای برای {title} دریافت نشد.</p> : <>
      <div className="chart-range"><span>{maximum.toLocaleString('fa-IR', { maximumFractionDigits: 5 })}</span><span>{minimum.toLocaleString('fa-IR', { maximumFractionDigits: 5 })}</span></div>
      <svg viewBox="0 0 320 110" role="img" aria-label={`نمودار ${title} با مقادیر خام API`}><path d="M12 96H308 M12 56H308 M12 16H308" className="chart-grid"/>{series.map((row,index) => <g key={row.instance + index}><path d={path(row)} fill="none" stroke={colors[index % colors.length]} strokeWidth="2"/>{row.points.filter(point => point.value !== null).map((point,i) => <circle key={i} cx={12 + (point.x - first)/(last-first || 1)*296} cy={96-(point.value!-minimum)/range*80} r="2" fill={colors[index % colors.length]}><title>{row.instance}: {point.value} · X خام: {point.x}</title></circle>)}</g>)}</svg>
      <div className="chart-axis"><span>X کمتر</span><span>X بیشتر</span></div>
      <details className="raw-values"><summary>مقادیر خام {title}</summary><div className="table-scroll"><table><thead><tr><th>نمونه</th><th>ستون اول API</th><th>مقدار خام</th></tr></thead><tbody>{series.flatMap(row => row.points.slice(-10).map((point,i) => <tr key={row.instance+i}><td>{row.instance}</td><td>{point.x}</td><td>{point.value ?? 'ناموجود'}</td></tr>))}</tbody></table></div></details>
    </>}
    <Source value={result.evidence}/>
  </figure>;
}

export function LiaraPanel({ onEvidence, disabled }: { onEvidence: (value: EvidenceSelection | null) => void; disabled: boolean }) {
  const [status, setStatus] = useState<LiaraStatus | null>(null);
  const [apps, setApps] = useState<Evidence<LiaraApp[]> | null>(null);
  const [snapshot, setSnapshot] = useState<LiaraSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void request<LiaraStatus>('/api/liara/status', 'GET', undefined, abort.signal).then(async value => {
      if (abort.signal.aborted) return; setStatus(value);
      if (value.state === 'connected') {
        const list = await request<Evidence<LiaraApp[]>>('/api/liara/apps', 'GET', undefined, abort.signal);
        if (!abort.signal.aborted) setApps(list);
      }
    }).catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    return () => abort.abort();
  }, []);
  function invalidate() { setSnapshot(null); onEvidence(null); setQuery(''); }
  async function run(action: 'connect' | 'disconnect' | 'refresh' | 'select' | 'scope', appId?: string) {
    setPending(action); setError(''); invalidate();
    try {
      if(action==='scope'){
        setApps(null);const next=await request<LiaraStatus>('/api/liara/scope','POST',appId==='personal'?{kind:'personal'}:{kind:'team',teamId:appId});setStatus(next);setApps(await request<Evidence<LiaraApp[]>>('/api/liara/apps'));invalidate();
      } else if (action === 'connect') {
        setApps(null); const next = await request<LiaraStatus>('/api/liara/connect', 'POST'); setStatus(next);
        setApps(await request<Evidence<LiaraApp[]>>('/api/liara/apps'));
      } else if (action === 'disconnect') { setStatus(await request<LiaraStatus>('/api/liara/disconnect', 'POST')); setApps(null); }
      else {
        if (action === 'select') setStatus(await request<LiaraStatus>('/api/liara/selection', 'POST', { appId }));
        const value = await request<LiaraSnapshot>('/api/liara/refresh', 'POST'); setSnapshot(value);
        // A snapshot ID is server-issued; the checkbox in chat separately controls sharing.
        onEvidence({ id: value.id, appId: value.appId, fetchedAt: value.fetchedAt });
      }
    } catch (e) {
      setError((e as Error).message);
      try { setStatus(await request<LiaraStatus>('/api/liara/status')); } catch { /* Keep the actual request failure visible. */ }
    } finally { setPending(null); }
  }
  const logs = snapshot?.logs.state === 'ok' ? snapshot.logs.evidence.data.filter(row => `${row.message} ${row.level}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : [];
  const locked = disabled || pending !== null;
  const stateLabels: Record<LiaraStatus['state'], string> = { unconfigured: 'تنظیم نشده', disconnected: 'متصل نیست', connected: 'اتصال تأیید شد', auth_required: 'نیاز به توکن معتبر', error: 'اتصال ناموفق' };
  return <section className="liara-panel" aria-label="مشاهدهٔ برنامه‌های لیارا" aria-busy={pending !== null}>
    <div className="liara-heading"><div><span className="eyebrow">LIARA CLOUD</span><h2>وضعیت وب‌سایت در لیارا</h2></div><span className="mode-label">فقط خواندنی</span></div>
    {!status && !error ? <p role="status">در حال بررسی تنظیمات محلی…</p> : null}
    {status ? <>
      <div className="application-picker"><label htmlFor="liara-account-scope">محدودهٔ حساب لیارا</label><select id="liara-account-scope" value={status.scope?.kind==='team'?status.scope.teamId:'personal'} disabled={locked||!status.configured} onChange={e=>void run('scope',e.target.value)}><option value="personal">حساب شخصی</option><option value={VERIFIED_TEAM_ID}>تیم لیارا</option></select><p>انتخاب محدوده فقط دسترسی را بررسی می‌کند؛ ساخت منابع یا استفاده از اعتبار تیم تأیید جداگانه می‌خواهد.</p>{status.scope?.kind==='team'&&<code dir="ltr">{status.scope.teamId}</code>}</div>
      <div className="liara-connection"><div><strong>{stateLabels[status.state]}</strong>{status.account ? <p>{status.account.name ?? 'حساب متصل'} · آخرین بررسی: {status.verifiedAt ? displayTime(status.verifiedAt) : 'نامشخص'}</p> : null}</div><div className="liara-buttons"><button className="button secondary" disabled={locked || !status.configured} onClick={() => void run('connect')}>بررسی اتصال لیارا</button>{status.state === 'connected' ? <button className="button secondary" disabled={locked} onClick={() => void run('disconnect')}>قطع اتصال لیارا</button> : null}</div></div>
      {!status.configured ? <div className="credential-help"><strong>توکن لیارا تنظیم نشده است.</strong><p>برنامه را متوقف و راه‌انداز زیر را در PowerShell اجرا کنید. توکن فقط در پنجرهٔ محلی با ورودی مخفی دریافت می‌شود و ذخیره نمی‌شود.</p><code dir="ltr">.\scripts\start-with-liara.ps1</code><p>سپس به این صفحه برگردید و اتصال را بررسی کنید. توکن را در گفت‌وگو وارد نکنید.</p></div> : null}
      {status.error && !error ? <ErrorNotice message={status.error.message} guidance="اتصال لیارا را بررسی کنید؛ سپس دوباره فقط‌خواندنی تلاش کنید."/> : null}
      {status.state === 'connected' && apps ? <>
        {apps.data.length === 0 ? <p className="section-empty">برنامه‌ای در این حساب دریافت نشد.</p> : <div className="application-picker"><label htmlFor="liara-app">برنامهٔ لیارا</label><select id="liara-app" value={status.selectedApp ?? ''} disabled={locked} onChange={e => void run('select', e.target.value)}><option value="" disabled>یک برنامه انتخاب کنید</option>{apps.data.map(app => <option key={app.id} value={app.id}>{app.id}{app.platform ? ` · ${app.platform}` : ''}</option>)}</select><button className="button secondary" disabled={locked || !status.selectedApp} onClick={() => void run('refresh')}>به‌روزرسانی اطلاعات</button></div>}
        <Source value={apps}/>
      </> : null}
    </> : null}
    {pending ? <p className="liara-loading" role="status">در حال دریافت اطلاعات واقعی لیارا…</p> : null}
    {error ? <ErrorNotice message={error} guidance="حساب یا برنامهٔ انتخابی را بررسی کنید و اطلاعات را دوباره بخوانید."/> : null}
    {snapshot ? <div className="liara-observability">
      <div className="snapshot-caption"><strong dir="ltr">{snapshot.appId}</strong><span>بازهٔ درخواستی: ۳۰ دقیقهٔ اخیر · نمونه‌های آخر · {displayTime(snapshot.fetchedAt)}</span></div>
      {snapshot.details.state === 'ok' ? <div className="app-facts"><div>وضعیت گزارش‌شده<strong>{snapshot.details.evidence.data.status ?? 'نامشخص'}</strong></div><div>پلتفرم<strong>{snapshot.details.evidence.data.platform ?? 'نامشخص'}</strong></div><div>استقرار گزارش‌شده<strong>{snapshot.details.evidence.data.deployed === null ? 'نامشخص' : snapshot.details.evidence.data.deployed ? 'دارد' : 'ندارد'}</strong></div><Source value={snapshot.details.evidence}/></div> : <Failure result={snapshot.details}/>}
      {snapshot.details.state==='ok'&&<p>شناسهٔ واقعی برنامه: <bdi>{snapshot.details.evidence.data.projectId??'نامشخص'}</bdi></p>}
      {snapshot.releases.state==='ok'&&snapshot.releases.evidence.data.map(row=><p key={row.id}>شناسهٔ انتشار: <bdi>{row.id}</bdi> · {row.isCurrent===true?'انتشار جاری تأییدشده':row.isCurrent===false?'انتشار غیرجاری':'جاری بودن نامشخص'}</p>)}
      <p className="observability-note">این وضعیت، گزارش API است و سلامت HTTP سایت را تأیید نمی‌کند. واحد و قالب زمان نمودارها در قرارداد API مشخص نشده‌اند؛ درصد یا مگابایت فرض نمی‌کنیم.</p>
      <div className="metrics-grid"><MetricChart title="CPU" result={snapshot.cpu}/><MetricChart title="RAM" result={snapshot.memory}/></div>
      <section className="logs-section"><div className="section-heading"><h3>لاگ‌های اخیر</h3><span>حداکثر ۲۰۰ خط · پاک‌سازی‌شده</span></div>{snapshot.logs.state === 'ok' ? <><label className="sr-only" htmlFor="log-search">جست‌وجو در لاگ‌ها</label><input id="log-search" type="search" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} placeholder="جست‌وجو در لاگ‌ها…"/><div className="log-list">{logs.length ? logs.map((row,index) => <article className="log-row" key={index}><time dateTime={row.timestamp}>{displayTime(row.timestamp)}</time><span className="log-level">{row.level}</span><pre dir="auto">{row.message}</pre></article>) : <p className="section-empty">{query ? 'لاگی مطابق جست‌وجو نیست.' : 'لاگی در پاسخ این بازه دریافت نشد.'}</p>}</div><Source value={snapshot.logs.evidence}/></> : <Failure result={snapshot.logs}/>}</section>
      <section className="releases-section"><h3>انتشارهای اخیر</h3>{snapshot.releases.state === 'ok' ? <>{snapshot.releases.evidence.data.length ? <ul>{snapshot.releases.evidence.data.map(row => <li key={row.id}><span dir="ltr">{row.tag ?? row.id}</span><span>{row.state ?? 'نامشخص'}</span><time>{row.createdAt ? displayTime(row.createdAt) : 'زمان نامشخص'}</time></li>)}</ul> : <p className="section-empty">انتشاری دریافت نشد.</p>}<Source value={snapshot.releases.evidence}/></> : <Failure result={snapshot.releases}/>}</section>
    </div> : null}
  </section>;
}
