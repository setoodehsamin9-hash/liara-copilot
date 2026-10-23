import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { chat, connect, getStatus } from './api.js';
import type { ConnectionStatus } from '../server/protocol.js';
import { LiaraPanel, type EvidenceSelection } from './LiaraPanel.js';
import { DiagnosisPanel } from './DiagnosisPanel.js';
import { SourcePanel } from './SourcePanel.js';
import { RepairPanel } from './RepairPanel.js';
import { OperationsPanel } from './OperationsPanel.js';
import { DeploymentGuide } from './DeploymentGuide.js';
import {DemoJourney} from './DemoJourney.js';
import {RecordingDemo} from './RecordingDemo.js';
import './style.css';
import './experience.css';

type Message = { id: string; role: 'user' | 'assistant' | 'guide'; text: string; state?: string };
type Page = 'home' | 'deploy' | 'health' | 'diagnosis' | 'operations';
const initial: ConnectionStatus = { state: 'disconnected', message: 'برای شروع، اتصال Codex را بررسی کنید.', verifiedConversation: false };
const labels: Record<ConnectionStatus['state'], string> = { ready: 'دستیار آماده است', disconnected: 'دستیار هنوز متصل نیست', connecting: 'در حال اتصال', auth_required: 'نیاز به ورود به Codex', error: 'اتصال دستیار برقرار نشد' };
const nav: { id: Page; label: string; icon: string }[] = [
  { id: 'home', label: 'دستیار', icon: 'chat' }, { id: 'deploy', label: 'استقرار', icon: 'cloud' },
  { id: 'health', label: 'سلامت', icon: 'pulse' }, { id: 'diagnosis', label: 'عیب‌یابی', icon: 'repair' },
  { id: 'operations', label: 'عملیات', icon: 'list' },
];
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    chat: <><path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 9h8M8 12.5h5"/></>,
    cloud: <><path d="M7 18h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.6-1.5A4.8 4.8 0 0 0 7 18Z"/></>,
    pulse: <><path d="M2 12h4l2.5-5 4 10 2.5-5H22"/></>,
    repair: <><path d="m14 7 3-3 3 3-3 3M13 11 4 20l-2-2 9-9M14 7l3 3"/></>,
    list: <><path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/></>,
    moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
const starters: { page: Page; title: string; copy: string; icon: string }[] = [
  { page: 'deploy', title: 'استقرار وب‌سایت', copy: 'از انتخاب سورس تا کنسول، قدم‌به‌قدم', icon: 'cloud' },
  { page: 'diagnosis', title: 'عیب‌یابی و تعمیر', copy: 'بررسی شواهد و تعمیر در نسخهٔ جدا', icon: 'repair' },
  { page: 'health', title: 'بررسی سلامت', copy: 'دیدن وضعیت واقعی برنامه و لاگ‌ها', icon: 'pulse' },
  { page: 'home', title: 'پرسش دربارهٔ لیارا', copy: 'راهنمایی ساده برای انتخاب‌های فنی', icon: 'chat' },
];
function App() {
  const [page, setPage] = useState<Page>('home');
  const [demoOpen,setDemoOpen]=useState(false);
  const [status, setStatus] = useState(initial);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [joined, setJoined] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const [preflightGeneration, setPreflightGeneration] = useState(0);
  const [attachEvidence, setAttachEvidence] = useState(false);
  const evidenceChanged = useCallback((value: EvidenceSelection | null) => { setEvidence(value); setAttachEvidence(false); setPreflightGeneration(current => current + 1); }, []);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('liara-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('liara-theme', theme); } catch { /* optional */ } }, [theme]);
  useEffect(() => {
    let live = true;
    const refresh = () => { void getStatus().then(r => { if (live) setStatus(r.codex); }).catch(() => { if (live) setStatus({ ...initial, message: 'برنامهٔ محلی در دسترس نیست.' }); }); };
    refresh(); const timer = setInterval(refresh, 8000);
    return () => { live = false; clearInterval(timer); controller.current?.abort(); };
  }, []);
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, progress]);
  function go(next: Page) { setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function ask(question: string) { setDraft(question); go('home'); requestAnimationFrame(() => input.current?.focus()); }
  async function reconnect() {
    setConnecting(true); setError('');
    try {
      const next = (await connect()).codex; setStatus(next); setJoined(next.state === 'ready');
      setMessages([]); setProgress('');
    } catch (e) { setError((e as Error).message); } finally { setConnecting(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); const text = draft.trim(); if (!text || busy || connecting) return;
    if (/(۵۰۰|500)/.test(text) && /(خطا|ارور|error|fix|درست|تعمیر|checkout)/i.test(text)) {
      setMessages(old=>[...old,{id:crypto.randomUUID(),role:'user',text},{id:crypto.randomUUID(),role:'guide',text:'ابتدا وضعیت فعلی سایت و شواهد را می‌خوانیم. چون نسخهٔ زنده ممکن است دیگر خراب نباشد، baseline تاریخی را جداگانه برای تعمیر محلی بررسی می‌کنیم. هر مرحله و اجازهٔ لازم همین‌جا نمایش داده می‌شود.'}]);
      setDraft('');setDemoOpen(true);setError('');requestAnimationFrame(()=>document.getElementById('demo-journey')?.scrollIntoView({behavior:'smooth',block:'start'}));return;
    }
    if(!joined||status.state!=='ready'){
      setConnecting(true);setError('');setProgress('در حال اتصال به Codex برای همین پیام…');
      try{const next=(await connect()).codex;setStatus(next);setJoined(next.state==='ready');if(next.state!=='ready'){setError(next.message);setProgress('پیام شما هنوز ارسال نشده است.');return;}}
      catch(e){setError((e as Error).message);setProgress('اتصال کامل نشد؛ متن پیام حفظ شد.');return;}
      finally{setConnecting(false);}
    }
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'user', text }]);
    setDraft(''); setBusy(true); setError(''); setProgress('دستیار در حال بررسی درخواست شماست…');
    const streamId = crypto.randomUUID(); const abort = new AbortController(); controller.current = abort;
    try {
      await chat(text, event => {
        if (event.type === 'progress') setProgress(event.message);
        if (event.type === 'delta' || event.type === 'message') {
          const id = streamId + event.itemId;
          setMessages(old => {
            const existing = old.find(m => m.id === id);
            const value = event.type === 'message' ? event.text : (existing?.text ?? '') + event.text;
            return existing ? old.map(m => m.id === id ? { ...m, text: value } : m) : [...old, { id, role: 'assistant', text: value }];
          });
        }
        if (event.type === 'error') setError(event.message);
        if (event.type === 'done') {
          setProgress(event.status === 'completed' ? 'پاسخ کامل شد.' : 'پاسخ کامل نشد؛ جزئیات را بررسی کنید.');
          setMessages(old => old.map(m => m.id.startsWith(streamId) ? { ...m, state: event.status } : m));
        }
      }, abort.signal, attachEvidence ? evidence?.id : undefined);
    } catch (e) {
      const cancelled = (e as Error).name === 'AbortError';
      setError(cancelled ? 'پاسخ متوقف شد. برای ادامه، گفت‌وگوی تازه باز کنید.' : (e as Error).message);
      setProgress('این درخواست کامل نشد.');
      setMessages(old => old.map(m => m.id.startsWith(streamId) ? { ...m, state: 'interrupted' } : m));
    } finally {
      setBusy(false); controller.current = null;
      void getStatus().then(r => setStatus(r.codex)).catch(() => setStatus(initial));
    }
  }
  function navButton(item: typeof nav[number]) { return <button type="button" key={item.id} className={page === item.id ? 'app-nav-item active' : 'app-nav-item'} aria-current={page === item.id ? 'page' : undefined} onClick={() => go(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>; }
  return <div className="app-shell">
    <aside className="sidebar" aria-label="ناوبری اصلی">
      <a className="brand" href="/" onClick={event => { event.preventDefault(); go('home'); }} aria-label="صفحهٔ اصلی لیارا کوپایلوت"><span className="brand-mark" aria-hidden="true">ل</span><span>لیارا <strong>کوپایلوت</strong><small>همراه امن وب‌سایت شما</small></span></a>
      <nav className="app-nav" aria-label="بخش‌ها">{nav.map(navButton)}</nav>
      <div className="sidebar-trust"><strong>تصمیم با شماست</strong><p>دستیار پیشنهاد می‌دهد؛ تغییرات مهم و انتشار فقط پس از بازبینی شما انجام می‌شوند.</p></div>
      <div className="account"><span className="avatar" aria-hidden="true">ش</span><div>محیط محلی<small>اطلاعات حساس در مرورگر ذخیره نمی‌شود</small></div></div>
    </aside>
    <main>
      <header className="topbar"><div className="topbar-status"><span className={'status-dot ' + status.state}/><span>{labels[status.state]}</span></div><div className="topbar-actions"><a className="top-help" href="/?demo=recording">دموی آمادهٔ ضبط</a><button type="button" className="top-help" onClick={() => ask('لیارا کوپایلوت چه کارهایی می‌تواند انجام دهد و کدام اقدامات تأیید من را می‌خواهند؟')}>راهنما</button><button type="button" className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'فعال کردن تم روشن' : 'فعال کردن تم تاریک'}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/></button></div></header>
      <div className="workspace">
        <div hidden={page !== 'home'} className="page-view home-view">
          <section className="home-intro"><h1>امروز چطور کمکت کنم؟</h1><p>درخواستت را ساده بنویس. گزینه‌ها و گام‌های بعدی را توضیح می‌دهیم؛ تصمیم‌های مهم با تأیید تو انجام می‌شوند.</p></section>
          <div className="demo-entry"><div><strong>اولین بار است؟ یک تعمیر واقعی را امتحان کن</strong><p>خطای پرداخت در نسخهٔ محلی بازتولید می‌شود؛ Codex آن را تعمیر و آزمون می‌کند. به توکن لیارا نیاز ندارد.</p></div><button className="button primary" disabled={busy||connecting} onClick={()=>{setDemoOpen(true);requestAnimationFrame(()=>document.getElementById('demo-journey')?.scrollIntoView({behavior:'smooth',block:'start'}));}}>شروع دموی تعمیر</button></div>
          <section className="chat-card" aria-label="گفت‌وگو">
            <div className="chat-header"><strong>گفت‌وگو با دستیار</strong><span className="mode-label">پیشنهاد و راهنمایی · بدون اجرای خودکار</span></div>
            <form className="composer" onSubmit={event => void send(event)}><label htmlFor="message">درخواست خود را بنویسید</label><textarea ref={input} id="message" placeholder="مثلاً: وب‌سایتم خطای ۵۰۰ می‌دهد؛ از کجا شروع کنم؟" value={draft} maxLength={4000} rows={3} onChange={event => setDraft(event.target.value)} disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/><div className="composer-actions"><small>{draft.length.toLocaleString('fa-IR')} / ۴٬۰۰۰</small>{busy ? controller.current ? <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>توقف پاسخ</button> : <small role="status">عملیات جاری را در بخش خودش پیگیری کنید.</small> : <button className="button primary" type="submit" disabled={!draft.trim() || connecting || (!/(۵۰۰|500)/.test(draft) && status.state === 'auth_required')}>ارسال پیام</button>}</div></form>
            <div className="connection-inline"><div><strong>{labels[status.state]}</strong><p>{connecting ? 'در حال آماده‌کردن اتصال برای پیام شما…' : status.state === 'auth_required' || status.state === 'error' ? status.message : 'پیامت را بفرست؛ اتصال Codex خودکار آماده می‌شود. تعمیر و انتشار اجازهٔ جداگانه می‌خواهند.'}</p></div><button className="button secondary" onClick={() => void reconnect()} disabled={busy || connecting}>{connecting ? 'در حال بررسی…' : status.state === 'ready' ? 'گفت‌وگوی تازه' : 'اتصال به Codex'}</button></div>
            {evidence && <div className="evidence-opt-in"><label><input type="checkbox" checked={attachEvidence} disabled={busy} onChange={event => setAttachEvidence(event.target.checked)}/> اشتراک شواهد پاک‌سازی‌شده با Codex</label><small><bdi>{evidence.appId}</bdi> · {evidence.fetchedAt} · اعتبار پیوست: ۵ دقیقه</small><small>برای کنارگذاشتن شواهد قبلی از گفت‌وگوی تازه استفاده کنید.</small></div>}
            {messages.length > 0 && <div className="conversation" role="log" aria-label="پیام‌های گفت‌وگو" aria-live="polite" aria-relevant="additions text">{messages.map(message => <article className={'message ' + message.role} key={message.id}><span className="message-author">{message.role === 'user' ? 'شما' : message.role === 'guide' ? 'راهنمای برنامه' : 'دستیار'}</span><p dir="auto">{message.text}</p>{message.state && message.state !== 'completed' && <small className="incomplete">پاسخ کامل نشده است</small>}</article>)}<div ref={bottom}/></div>}
            {(progress || status.verifiedConversation) && <p className="stream-progress" role="status">{progress || 'اتصال با پاسخ واقعی تأیید شده است.'}</p>}
            {error && <div className="error-message" role="alert"><strong>درخواست کامل نشد.</strong><p>اتصال را بررسی کنید و در صورت نیاز گفت‌وگوی تازه باز کنید.</p><details><summary>جزئیات فنی</summary><span dir="auto">{error}</span></details></div>}
          </section>
          {demoOpen&&<DemoJourney evidence={evidence} onEvidence={evidenceChanged} ready={joined&&status.state==='ready'} busy={busy||connecting} onBusy={setBusy}/>}
          <section className="starter-section" aria-label="شروع سریع"><h2>از کجا شروع کنیم؟</h2><div className="starter-grid">{starters.map(item => <button key={item.title} type="button" className="starter" onClick={() => item.page === 'home' ? ask('در مورد امکانات لیارا و انتخاب گزینهٔ مناسب برای وب‌سایتم راهنمایی‌ام کن.') : go(item.page)}><span className={'starter-icon ' + item.icon}><Icon name={item.icon}/></span><span className="starter-copy"><strong>{item.title}</strong><small>{item.copy}</small></span><span className="starter-arrow" aria-hidden="true">‹</span></button>)}</div></section>
          <section className="home-journey" aria-label="روش کار"><div><span>۱</span><strong>پیشنهادها را بفهم</strong><p>دستیار بر اساس اطلاعات موجود، انتخاب‌ها را به زبان ساده توضیح می‌دهد.</p></div><div><span>۲</span><strong>اقدام مهم را خودت تأیید کن</strong><p>تعمیر در نسخهٔ جدا بررسی می‌شود؛ استقرار نهایی فعلاً در کنسول لیارا است.</p></div></section>
          <p className="home-notice">استقرار خودکار این نسخه فعال و تأییدشده نیست. راهنمای گام‌به‌گامِ استقرار دستی در دسترس است.</p>
        </div>
        <div hidden={page !== 'deploy'} className="page-view"><DeploymentGuide key={'deploy-' + preflightGeneration} appId={evidence?.appId} disabled={busy || connecting} onBusy={setBusy} onAsk={ask} onHealth={() => go('health')}/></div>
        <div hidden={page !== 'health' && page !== 'diagnosis'} className="page-view">
          <div className="section-intro"><h1>{page === 'diagnosis' ? 'اول شواهد را ببین، بعد علت را بررسی کن' : 'از وضعیت واقعی برنامه باخبر شو'}</h1><p>برنامه را از حساب تأییدشده انتخاب کن. زمان و منبع هر داده کنار آن نمایش داده می‌شود.</p></div>
          <LiaraPanel onEvidence={evidenceChanged} disabled={busy || connecting}/>
          <div hidden={page !== 'health'} className="health-foot"><button className="button primary" onClick={() => go('diagnosis')}>بررسی علت یک خطا</button><button className="button secondary" onClick={() => ask('این شاخص‌های سلامت برنامهٔ لیارا چه معنایی دارند؟')}>از دستیار بپرس</button></div>
        </div>
        <div hidden={page !== 'diagnosis'} className="page-view"><DiagnosisPanel key={'diagnosis-' + preflightGeneration} evidence={evidence} ready={joined && status.state === 'ready'} busy={busy || connecting} onBusy={setBusy}/><SourcePanel key={'source-' + preflightGeneration} appId={evidence?.appId} disabled={busy || connecting}/><RepairPanel key={'repair-' + preflightGeneration} appId={evidence?.appId} disabled={busy || connecting} onBusy={setBusy}/></div>
        <div hidden={page !== 'operations'} className="page-view"><div className="section-intro"><h1>پیگیری عملیات</h1><p>وضعیت‌های نامشخص را با دقت بررسی کن. هیچ ارسال دوباره‌ای به‌طور خودکار انجام نمی‌شود.</p></div><OperationsPanel disabled={busy || connecting} onBusy={setBusy}/></div>
        <footer className="workspace-footer">کنترل در دست شماست. دادهٔ زنده، بررسی محلی و پیشنهاد هوش مصنوعی جداگانه مشخص می‌شوند.</footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="ناوبری موبایل">{nav.map(navButton)}</nav>
  </div>;
}
const recording = new URLSearchParams(window.location.search).get('demo') === 'recording';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{recording ? <RecordingDemo/> : <App/>}</React.StrictMode>);
