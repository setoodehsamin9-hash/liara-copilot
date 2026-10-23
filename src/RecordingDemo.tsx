import { useEffect, useRef, useState } from 'react';
import { recordingDuration, recordingSceneAt, recordingScenes, recordingTime, sceneStarts } from './recording-scenario.js';
import './recording.css';

const workDuration = 4;
type Outcome = 'success' | 'failed' | 'uncertain';
const requestText = 'فروشگاهم باز می‌شود، اما مشتری موقع پرداخت خطای ۵۰۰ می‌گیرد. بررسی کن مشکل از کجاست و راه‌حل پیشنهاد بده.';

function Glyph({ name, size = 21 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    chat: <><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7 5.8l9 5"/></>,
    pulse: <path d="M2 12h4l3-7 5 14 3-7h5"/>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/></>,
    tool: <><path d="m14 5 5-2-1 5-5 3-8 9-3-3 9-8 3-4Z"/></>,
    cloud: <><path d="M6 18h12a4 4 0 0 0 .5-8 6 6 0 0 0-11.8-1A4.6 4.6 0 0 0 6 18Z"/><path d="M12 10v6m-3-3 3 3 3-3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    list: <><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/></>,
    play: <path d="m8 4 12 8-12 8V4Z"/>,
    pause: <><path d="M8 4v16M16 4v16"/></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>,
    arrow: <path d="M20 12H4m6-6-6 6 6 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.check}</svg>;
}
const icons = ['chat', 'box', 'pulse', 'search', 'tool', 'cloud', 'check', 'list'];
function Pill({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'red' | 'amber' | 'neutral' }) {
  return <span className={`rec-pill ${tone}`}>{children}</span>;
}
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rec-card ${className}`}>{children}</section>;
}
function Endpoints({ healthy }: { healthy: boolean }) {
  return <div className="rec-endpoints">{[['/', 'صفحهٔ اصلی'], ['/health', 'سلامت سرور'], ['/api/checkout', 'پرداخت مشتری']].map(([path, label], i) => <div className="rec-endpoint" key={path}><div><strong>{label}</strong><code dir="ltr">GET {path}</code></div><Pill tone={i === 2 && !healthy ? 'red' : 'green'}>{i === 2 && !healthy ? '500 · خطای سرور' : '200 · موفق'}</Pill></div>)}</div>;
}
function Metrics({ healthy }: { healthy: boolean }) {
  return <div className="rec-metrics">{[
    ['مسیرهای سالم', healthy ? '۳ از ۳' : '۲ از ۳', healthy ? 'همهٔ مسیرها پاسخ می‌دهند' : 'پرداخت نیاز به بررسی دارد'],
    ['زمان پاسخ نمونه', healthy ? '۱۲۸ ms' : '۲۴۶ ms', 'آخرین بررسی نمایشی'],
    ['آزمون‌های موفق', healthy ? '۴ از ۴' : '۳ از ۴', healthy ? 'پس از اصلاح کد' : 'پیش از اصلاح کد'],
  ].map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>;
}
function CodeChange() {
  return <div className="rec-diff" dir="ltr"><div className="rec-code-title">app.mjs <span>یک تغییر کوچک، یک رفتار درست</span></div><div className="removed"><span>−</span><code>const coupon = url.searchParams.get('coupon').trim();</code></div><div className="added"><span>+</span><code>const coupon = (url.searchParams.get('coupon') ?? '').trim();</code></div></div>;
}
function saveReport() {
  const report = `# گزارش نمایشی لیارا کوپایلوت\n\nاین فایل نتیجهٔ شبیه‌سازی محلی است؛ آزمون، اتصال یا انتشار واقعی انجام نشده است.\n\nپروژه: فروشگاه نارون (narvan-shop-demo)\nسناریو: خطای پرداخت بدون کد تخفیف\nعلت نمونه: فراخوانی trim روی null\nاصلاح نمونه: مقدار پیش‌فرض برای coupon اختیاری\nنتیجهٔ فرضی: چهار آزمون موفق و پاسخ ۲۰۰ هر سه مسیر\nانتشار نمایش داده شده: شبیه‌سازی؛ مسیر فعلی محصول انتشار دستی در کنسول است.\n\n${recordingScenes.map((scene, index) => `${index + 1}. ${scene.title}`).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'liara-demo-report.fa.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RecordingDemo() {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [manualStage, setManualStage] = useState(0);
  const [manualWork, setManualWork] = useState(0);
  const [working, setWorking] = useState(false);
  const [notes, setNotes] = useState(false);
  const [approved, setApproved] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [reconciled, setReconciled] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [draft, setDraft] = useState(requestText);
  const stage = mode === 'auto' ? recordingSceneAt(elapsed) : manualStage;
  const scene = recordingScenes[stage]!;
  const sceneElapsed = elapsed - sceneStarts[stage]!;
  const work = mode === 'auto' ? Math.max(0, sceneElapsed - 2) : manualWork;
  const started = work > 0;
  const done = work >= workDuration;
  const busy = started && !done;
  const autoApproval = mode === 'auto' && sceneElapsed >= 1;
  const effectiveOutcome = mode === 'auto' ? 'success' : outcome;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'دموی ارائه | لیارا کوپایلوت';
    document.documentElement.dataset.theme = 'light';
  }, []);
  useEffect(() => {
    if (!playing) return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now(); const delta = (now - previous) / 1000; previous = now;
      setElapsed(value => Math.min(recordingDuration, value + delta));
    }, 200);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (elapsed >= recordingDuration) setPlaying(false); }, [elapsed]);
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setManualWork(value => Math.min(workDuration, value + 0.2)), 200);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => { if (manualWork >= workDuration) setWorking(false); }, [manualWork]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [stage]);

  function jump(index: number) {
    setPlaying(false); setMode('manual'); setManualStage(index); setElapsed(sceneStarts[index]!);
    setWorking(false); setManualWork(0); setApproved(false); setRejected(false); setReconciled(false); setDownloaded(false);
  }
  function reset() { jump(0); setOutcome('success'); setDraft(requestText); }
  function togglePlayback() {
    if (playing) { setPlaying(false); return; }
    if (elapsed >= recordingDuration) { setElapsed(0); setManualStage(0); }
    else if (mode === 'manual') setElapsed(sceneStarts[manualStage]!);
    setWorking(false); setMode('auto'); setOutcome('success'); setRejected(false); setPlaying(true);
  }
  function perform() {
    if (stage === 7) { saveReport(); setDownloaded(true); return; }
    if (stage === 5 && !approved) return;
    setManualWork(0.05); setWorking(true); setReconciled(false);
  }

  return <div className="recording-app">
    <aside className="rec-sidebar">
      <a className="rec-brand" href="/?demo=recording" aria-label="شروع دموی لیارا کوپایلوت"><span className="rec-brand-mark">ل</span><div>لیارا <b>کوپایلوت</b><small>از مسئله تا راه‌حل، کنار شما</small></div></a>
      <div className="rec-nav-label">مسیر ارائه</div>
      <nav aria-label="فصل‌های دمو">{recordingScenes.map((item, index) => <button key={item.title} className={`rec-nav-item ${stage === index ? 'active' : ''} ${stage > index ? 'complete' : ''}`} aria-current={stage === index ? 'step' : undefined} onClick={() => jump(index)}><span className="rec-nav-icon"><Glyph name={stage > index ? 'check' : icons[index]!}/></span><span>{item.title}<small>{item.section}</small></span><span className="rec-nav-number">{String(index + 1).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}</span></button>)}</nav>
      <div className="rec-sidebar-foot"><span className="rec-online-dot"/><div>فروشگاه نارون<small dir="ltr">narvan-shop-demo</small></div><Pill tone="neutral">نمونه</Pill></div>
    </aside>

    <main className="rec-main">
      <header className="rec-header"><div className="rec-breadcrumb">فضای کار <span>/</span> فروشگاه نارون <span>/</span> <strong>{scene.section}</strong></div><span className="rec-demo-badge"><i/> دموی نمایشی · بدون اتصال خارجی</span></header>
      <div className="rec-body" ref={bodyRef}>
        <div className="rec-heading"><div><div className="rec-eyebrow">LIARA COPILOT <span> / </span> PRODUCT WALKTHROUGH</div><h1>{scene.title}</h1><p>{scene.subtitle}</p></div><div className="rec-chapter-count"><b>{String(stage + 1).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}</b><span>از ۸ فصل</span></div></div>

        <div className="rec-scene" key={stage}>
          {stage === 0 && <>
            <div className="rec-intro-banner"><div className="rec-large-icon"><Glyph name="chat" size={29}/></div><div><strong>مسئله را ساده بگو. قدم بعد را روشن ببین.</strong><p>یک دستیار برای فهمیدن خطا، بررسی راه‌حل و تصمیم آگاهانه.</p></div><span className="rec-banner-label">همراه وب‌سایت شما</span></div>
            <Card><div className="rec-card-heading"><h2>گفت‌وگو با دستیار</h2><Pill tone="neutral">پاسخ از پیش آماده</Pill></div>
              {!started ? <div className="rec-chat-empty"><span className="rec-empty-spark">✳</span><h3>از کجا شروع کنیم؟</h3><p>برای این ارائه، مسئلهٔ پرداخت فروشگاه آماده است.</p><div className="rec-suggestions"><span>بررسی سلامت</span><span>عیب‌یابی خطا</span><span>پیشنهاد اصلاح</span></div></div> : <div className="rec-chat-messages"><div className="rec-user-bubble"><small>شما</small><p>{draft}</p></div>{busy ? <div className="rec-thinking" role="status"><span className="rec-spinner"/> در حال آماده‌سازی مسیر بررسی…</div> : <div className="rec-assistant-bubble"><strong><Glyph name="chat" size={18}/> دستیار لیارا</strong><p>حتماً. اول پروژه و مسیر پرداخت را بررسی می‌کنیم، بعد علت خطا را از روی لاگ و سورس مشخص می‌کنیم. پیشنهاد اصلاح و نتیجهٔ آزمون‌ها را هم قبل از انتشار می‌بینی.</p><div className="rec-inline-steps"><span>۱ · شواهد</span><span>۲ · تشخیص</span><span>۳ · تعمیر</span><span>۴ · بازبینی</span></div></div>}</div>}
              {!started && <div className="rec-composer"><label htmlFor="rec-request">درخواست شما</label><textarea id="rec-request" value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={500}/><small>سناریو: پرداخت بدون کد تخفیف</small></div>}
            </Card>
          </>}

          {stage === 1 && <div className="rec-two-columns"><Card><div className="rec-card-heading"><h2>پروژهٔ انتخاب‌شده</h2><Glyph name="box"/></div><div className="rec-project"><span className="rec-project-logo">ن</span><div><h3>فروشگاه نارون</h3><code dir="ltr">narvan-shop-demo</code></div><Pill tone={done ? 'green' : 'neutral'}>{done ? 'آمادهٔ بررسی' : 'پروژهٔ نمونه'}</Pill></div><dl className="rec-facts"><div><dt>محیط</dt><dd>محیط نمایشی محلی</dd></div><div><dt>نوع برنامه</dt><dd>Node.js</dd></div><div><dt>پورت اجرا</dt><dd><code>3000</code></dd></div><div><dt>نسخهٔ فعلی</dt><dd><code>v1.0.0</code></dd></div></dl></Card><Card><div className="rec-card-heading"><h2>سورس پروژه</h2><Pill tone="neutral">فایل نمونه</Pill></div><div className="rec-file"><Glyph name="list" size={32}/><div><strong dir="ltr">narvan-shop-v1.zip</strong><small>کد برنامه + آزمون‌های نمونه</small></div><span>ZIP</span></div><div className="rec-file-tree" dir="ltr">narvan-shop/<br/>├── app.mjs<br/>├── server.mjs<br/>├── package.json<br/>└── tests/<br/>&nbsp;&nbsp;&nbsp; └── checkout.test.mjs</div><p className="rec-muted">این اطلاعات برای ارائه آماده شده‌اند و به حساب واقعی متصل نیستند.</p>{done && <div className="rec-success-line"><Glyph name="check" size={18}/> پروژه و سورس نمونه آمادهٔ بررسی‌اند.</div>}</Card></div>}

          {stage === 2 && <><Metrics healthy={false}/><div className="rec-two-columns"><Card><div className="rec-card-heading"><h2>پاسخ مسیرهای برنامه</h2><Pill tone={done ? 'red' : 'neutral'}>{done ? 'اختلال در پرداخت' : 'آمادهٔ بررسی'}</Pill></div>{done ? <Endpoints healthy={false}/> : <div className="rec-waiting"><Glyph name="pulse" size={40}/><h3>{busy ? 'در حال بررسی مسیرها…' : 'بررسی سلامت را شروع کن'}</h3><p>صفحهٔ اصلی، سلامت سرور و پرداخت مشتری</p></div>}</Card><Card><div className="rec-card-heading"><h2>لاگ مرتبط با خطا</h2><span className="rec-tiny">نمونهٔ شواهد</span></div><div className="rec-terminal" dir="ltr"><p><span>14:32:08</span> INFO server listening :3000</p><p><span>14:32:11</span> INFO GET /health 200</p>{done && <><p className="rec-log-error"><span>14:32:16</span> ERROR GET /api/checkout 500</p><p className="rec-log-error">CHECKOUT_COUPON_MISSING</p><p>TypeError: Cannot read properties of null<br/>&nbsp; (reading 'trim')</p></>}</div><div className="rec-insight"><strong>نکتهٔ قابل بررسی</strong><p>{done ? 'خطا فقط در پرداخت بدون کد تخفیف رخ می‌دهد. همین مسیر را در سورس دنبال می‌کنیم.' : 'سلامت هر قابلیت را باید در مسیر مربوط به خودش بررسی کرد.'}</p></div></Card></div></>}

          {stage === 3 && <><div className="rec-analysis-chain"><span><Glyph name="list"/> لاگ خطا</span><Glyph name="arrow"/><span><Glyph name="search"/> بررسی سورس</span><Glyph name="arrow"/><span><Glyph name="tool"/> پیشنهاد اصلاح</span></div><Card><div className="rec-card-heading"><h2>{done ? 'علت سناریوی نمونه مشخص شد' : 'تحلیل لاگ و بخش مرتبط کد'}</h2><Pill tone={done ? 'green' : 'neutral'}>{done ? 'قابل توضیح و بازبینی' : 'منتظر تحلیل'}</Pill></div><div className="rec-diagnosis-grid"><div><span className="rec-detail-label">آنچه کاربر می‌بیند</span><h3>پرداخت بدون کد تخفیف شکست می‌خورد.</h3><p className="rec-muted">کد تخفیف اختیاری است؛ نبودن آن نباید مانع پرداخت شود.</p>{done && <div className="rec-insight"><strong>علت فنی نمونه</strong><p>وقتی <code>coupon</code> ارسال نمی‌شود، مقدار <code>null</code> برمی‌گردد. اجرای <code>trim()</code> روی این مقدار باعث خطای ۵۰۰ می‌شود.</p></div>}</div><div className="rec-diagnosis-code"><span className="rec-detail-label">app.mjs · مسیر پرداخت</span><pre dir="ltr"><code>{"if (url.pathname === '/api/checkout') {\n  const coupon = url.searchParams\n    .get('coupon').trim();\n  return { status: 200, coupon };\n}"}</code></pre>{done && <div className="rec-fix-proposal"><Glyph name="check" size={18}/><span>پیشنهاد: مقدار پیش‌فرض + آزمون رگرسیون</span></div>}</div></div></Card><p className="rec-footnote">در این صفحه تحلیل از پیش نوشته شده است؛ درخواست واقعی به مدل ارسال نمی‌شود.</p></>}

          {stage === 4 && <><div className="rec-repair-banner"><span><Glyph name="tool"/> فضای تعمیر جداگانه</span><code dir="ltr">demo/checkout-fix</code><Pill tone="neutral">بازسازی نمایشی</Pill></div><Card><div className="rec-card-heading"><h2>بازبینی تغییر پیشنهادی</h2><span className="rec-tiny">app.mjs · یک خط اصلاح</span></div>{done ? <CodeChange/> : <div className="rec-waiting"><Glyph name="tool" size={34}/><h3>{busy ? 'در حال بازتولید خطا و آماده‌سازی اصلاح…' : 'تعمیر با اجازهٔ شما شروع می‌شود'}</h3><p>بازبینی کد و نتیجهٔ آزمون، پیش از تصمیم انتشار</p></div>}</Card><Card><div className="rec-card-heading"><h2>نمونهٔ نتیجهٔ آزمون‌ها</h2>{done && <Pill>۴ از ۴ موفق</Pill>}</div><div className="rec-test-table"><div className="rec-test-head"><span>آزمون</span><span>قبل از اصلاح</span><span>بعد از اصلاح</span></div>{['صفحهٔ اصلی در دسترس است', 'مسیر سلامت پاسخ می‌دهد', 'پرداخت بدون کد تخفیف', 'پرداخت با کد تخفیف'].map((label, i) => <div key={label}><strong>{label}</strong><span className={i === 2 ? 'rec-text-red' : 'rec-text-green'}>{i === 2 ? '× ناموفق' : '✓ موفق'}</span><span className={done ? 'rec-text-green' : 'rec-muted'}>{done ? '✓ موفق' : '—'}</span></div>)}</div><p className="rec-footnote">این نتایج برای سناریوی ارائه شبیه‌سازی شده‌اند؛ در حالت اصلی آزمون باید واقعاً اجرا شود.</p></Card></>}

          {stage === 5 && <><div className="rec-two-columns"><Card><div className="rec-card-heading"><h2>بازبینی پیش از انتشار</h2><Pill tone="amber">تصمیم با شماست</Pill></div><dl className="rec-facts"><div><dt>برنامهٔ مقصد</dt><dd><code>narvan-shop-demo</code></dd></div><div><dt>نسخهٔ پیشنهادی</dt><dd><code>v1.0.1</code></dd></div><div><dt>پورت</dt><dd><code>3000</code></dd></div><div><dt>تغییر</dt><dd>مدیریت کد تخفیف اختیاری</dd></div></dl><label className="rec-approval"><input type="checkbox" checked={mode === 'auto' ? autoApproval : approved} disabled={mode === 'auto' || started || rejected} onChange={event => setApproved(event.target.checked)}/><span>مقصد و تغییر پیشنهادی را برای این نمایش بازبینی کردم.</span></label><div className="rec-manual-notice">مسیر فعلی محصول: دریافت ZIP اصلاح‌شده و انتشار دستی در کنسول لیارا. مراحل مقابل، شبیه‌سازیِ تجربهٔ انتشار هستند.</div></Card><Card><div className="rec-card-heading"><h2>مراحل انتشار نمایشی</h2><Pill tone={rejected || (done && effectiveOutcome === 'failed') ? 'red' : done && effectiveOutcome === 'uncertain' && !reconciled ? 'amber' : 'neutral'}>{rejected ? 'لغو شد' : done ? effectiveOutcome === 'failed' ? 'ساخت ناموفق' : effectiveOutcome === 'uncertain' && !reconciled ? 'نیاز به استعلام' : 'تکمیل شد' : 'منتظر تأیید'}</Pill></div><ol className="rec-deploy-steps">{['آماده‌سازی بستهٔ اصلاح‌شده', 'ساخت نسخهٔ جدید', 'جایگزینی نسخهٔ برنامه', 'بررسی پاسخ برنامه'].map((label, index) => { const complete = !rejected && (done || work >= index + 1) && !(effectiveOutcome === 'failed' && index > 0) && !(effectiveOutcome === 'uncertain' && !reconciled && index > 1); return <li key={label} className={complete ? 'complete' : ''}><span>{complete ? <Glyph name="check" size={16}/> : index + 1}</span><div>{label}<small>{complete ? 'شبیه‌سازی شد' : 'در انتظار'}</small></div></li>; })}</ol>{rejected && <div className="rec-error-note">انتشار لغو شد؛ در این سناریو نسخهٔ قبلی حفظ می‌شود.<button className="rec-text-button" onClick={() => { setRejected(false); setApproved(false); }}>بازبینی دوباره</button></div>}{done && effectiveOutcome === 'failed' && <div className="rec-error-note">ساخت نمونه ناموفق بود. نسخهٔ قبلی حفظ می‌شود.<button className="rec-text-button" onClick={() => { setManualWork(0); setOutcome('success'); setApproved(false); }}>اصلاح و تلاش دوباره</button></div>}{done && effectiveOutcome === 'uncertain' && !reconciled && <div className="rec-uncertain-note">پاسخ انتشار دریافت نشده؛ ارسال دوباره انجام نمی‌شود.<button className="button secondary" onClick={() => setReconciled(true)}>استعلام وضعیت نمایشی</button></div>}{done && (effectiveOutcome === 'success' || reconciled) && <div className="rec-success-line"><Glyph name="check"/> {reconciled ? 'استعلام نمونه: انتشار قبلاً کامل شده است.' : 'نسخهٔ جدید در سناریوی نمایشی آماده است.'}</div>}</Card></div>{mode === 'manual' && !started && !rejected && <div className="rec-alternates"><span>مسیرهای اختیاری خارج از ویدیوی اصلی:</span>{([['success', 'انتشار موفق'], ['failed', 'شکست ساخت'], ['uncertain', 'پاسخ نامشخص']] as const).map(([value, label]) => <button key={value} aria-pressed={outcome === value} onClick={() => setOutcome(value)}>{label}</button>)}<button className="rec-cancel" onClick={() => { setRejected(true); setApproved(false); }}>لغو انتشار</button></div>}</>}

          {stage === 6 && <><Metrics healthy={done}/><div className="rec-two-columns"><Card><div className="rec-card-heading"><h2>بررسی دوبارهٔ مسیر پرداخت</h2><Pill tone={done ? 'green' : 'neutral'}>{done ? 'نتیجهٔ مورد انتظار' : 'آمادهٔ بررسی'}</Pill></div>{done ? <Endpoints healthy/> : <div className="rec-waiting"><Glyph name="pulse" size={36}/><h3>{busy ? 'در حال بررسی دوباره…' : 'نتیجه را با پاسخ مسیرها بررسی کن'}</h3><p>پایان ساخت، به تنهایی تأیید سلامت نیست.</p></div>}</Card><Card className="rec-shop-card"><div className="rec-shop-header"><span>نارون<span> / فروشگاه نمونه</span></span><code>v1.0.1</code></div><div className={`rec-payment ${done ? 'complete' : ''}`}><div className="rec-payment-icon"><Glyph name={done ? 'check' : 'box'} size={30}/></div><h3>{done ? 'پرداخت با موفقیت انجام شد' : 'پیش‌نمایش پرداخت'}</h3><p>{done ? 'سفارش نمونهٔ شما ثبت شد.' : 'منتظر نتیجهٔ بررسی نمایشی'}</p><dl><div><dt>شمارهٔ سفارش</dt><dd>NV-1042</dd></div><div><dt>کد تخفیف</dt><dd>وارد نشده</dd></div><div><dt>مبلغ نمونه</dt><dd>۸۹۰٬۰۰۰ تومان</dd></div></dl><span className="rec-tiny">پیش‌نمایش ثابت · هیچ تراکنشی انجام نمی‌شود</span></div></Card></div></>}

          {stage === 7 && <><div className="rec-summary-banner"><span className="rec-summary-icon"><Glyph name="check" size={30}/></span><div><h2>از یک خطای مبهم تا یک مسیر روشن</h2><p>شواهد مشخص، تغییر قابل بازبینی و تصمیم نهایی با کاربر.</p></div><Pill>پایان سناریوی اصلی</Pill></div><Card><div className="rec-card-heading"><h2>تاریخچهٔ سناریوی نمونه</h2><span className="rec-tiny">۸ رویداد · گزارش بازسازی‌شده</span></div><div className="rec-history">{recordingScenes.map((item, index) => <div key={item.title}><span className="rec-history-check"><Glyph name="check" size={15}/></span><strong>{item.title}</strong><span>{item.section}</span><code dir="ltr">{recordingTime(sceneStarts[index]!)}</code></div>)}</div><p className="rec-footnote">این تاریخچه، مراحل سناریوی از پیش نوشته شده را خلاصه می‌کند و گزارش عملیات واقعی نیست.</p></Card>{downloaded && <p role="status" className="rec-success-line">گزارش نمایشی دریافت شد.</p>}</>}
        </div>

        <div className="rec-scene-footer"><span role="status">{stage === 7 ? 'مسیر اصلی در ۴ دقیقه و ۲۰ ثانیه' : rejected ? 'انتشار در این مسیر لغو شده است.' : busy ? 'در حال نمایش عملیات نمونه…' : done ? 'نتیجهٔ نمایشی آمادهٔ بازبینی است.' : mode === 'auto' ? 'نمایش خودکار این فصل' : 'برای ادامه، اقدام این مرحله را اجرا کن.'}</span><div>{mode === 'manual' && !rejected && <button className="button primary rec-action" disabled={busy || (done && stage !== 7) || (stage === 5 && !approved) || (stage === 0 && !draft.trim())} onClick={perform}>{busy ? <><span className="rec-spinner"/> در حال نمایش…</> : done && stage !== 7 ? <><Glyph name="check" size={18}/> انجام شد</> : <>{scene.action}<Glyph name={stage === 7 ? 'list' : 'arrow'} size={18}/></>}</button>}{stage < recordingScenes.length - 1 && <button className="button secondary" onClick={() => jump(stage + 1)}>فصل بعد <Glyph name="arrow" size={16}/></button>}</div></div>
        {notes && <aside className="rec-presenter" aria-label="متن گویندگی"><strong>متن این فصل · {scene.duration.toLocaleString('fa-IR')} ثانیه</strong><p>{scene.narration}</p><small>{scene.cue}</small></aside>}
      </div>

      <footer className="rec-player" aria-label="کنترل ارائه"><div className="rec-player-top"><div className="rec-play-actions"><button className={`rec-play ${playing ? 'is-playing' : ''}`} onClick={togglePlayback}><Glyph name={playing ? 'pause' : 'play'} size={18}/>{playing ? 'توقف موقت' : mode === 'auto' && elapsed > 0 && elapsed < recordingDuration ? 'ادامهٔ پخش' : elapsed >= recordingDuration ? 'پخش دوباره' : 'پخش خودکار ۴:۲۰'}</button><button className="rec-icon-button" aria-label="شروع دوبارهٔ دمو" onClick={reset}><Glyph name="reset" size={18}/></button><span className="rec-player-time" dir="ltr"><b>{recordingTime(elapsed)}</b> / {recordingTime(recordingDuration)}</span></div><div className="rec-player-tools"><button onClick={() => setNotes(value => !value)} aria-pressed={notes}>{notes ? 'پنهان کردن متن' : 'متن گویندگی'}</button><a href="/demo-script.html" target="_blank" rel="noreferrer">سناریوی کامل ↗</a></div></div><div className="rec-timeline" role="progressbar" aria-label="پیشرفت ارائه" aria-valuemin={0} aria-valuemax={recordingDuration} aria-valuenow={Math.floor(elapsed)}>{recordingScenes.map((item, index) => <button key={item.title} style={{ flexGrow: item.duration }} onClick={() => jump(index)} aria-label={`رفتن به فصل ${index + 1}: ${item.title}`} title={`${recordingTime(sceneStarts[index]!)} · ${item.title}`}><span style={{ width: `${Math.min(100, Math.max(0, (elapsed - sceneStarts[index]!) / item.duration * 100))}%` }}/></button>)}</div></footer>
    </main>
  </div>;
}
