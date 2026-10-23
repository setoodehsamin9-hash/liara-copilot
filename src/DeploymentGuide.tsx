import { useEffect, useState } from 'react';
import { request } from './api.js';
import { SourcePanel } from './SourcePanel.js';
import { TestAppPanel } from './TestAppPanel.js';
import { inspectZipDirectory, type ZipSummary } from './zip-inspection.js';
import type { TestAppOptions } from '../server/test-app-options.js';

type SourceKind = 'zip' | 'github';
type Step = 1 | 2 | 3 | 4;
const help: Record<string, string> = {
  source: 'برای انتشار دستی، ZIP سورس را در کنسول لیارا انتخاب می‌کنید. اتصال GitHub موجود در کوپایلوت فقط اطلاعات نسخهٔ مخزن مجاز را می‌خواند؛ انتشار خودکار ایجاد نمی‌کند.',
  runtime: 'نوع اجرا مشخص می‌کند لیارا پروژه را چگونه می‌سازد و آغاز می‌کند. تشخیص این صفحه از نام فایل‌های ZIP فقط یک راهنمای اولیه است؛ تنظیمات واقعی پروژه را در کنسول بازبینی کنید.',
  plan: 'پلن مقدار CPU، حافظه و دیسک را تعیین می‌کند. پیشنهاد کوچک‌ترین پلن موجود فقط نقطهٔ شروع است، نه تضمین کارایی یا هزینه.',
  port: 'پورت شماره‌ای است که برنامه داخل محیط اجرا روی آن گوش می‌دهد. آن را با تنظیم برنامه و متغیر PORT در کنسول یکسان کنید.',
  network: 'شبکه، محل اتصال داخلی برنامه به منابع دیگر است. فقط شبکه‌های بازگشته از حساب انتخابی معتبرند؛ در صورت تردید تنظیم را در کنسول بررسی کنید.',
  cost: 'اعداد خام کاتالوگ، صورت‌حساب نهایی نیستند. مالیات، مصرف و هزینهٔ منابع دیگر ممکن است جداگانه محاسبه شوند.',
};
function Help({ topic, onAsk, context }: { topic: keyof typeof help; onAsk: (question: string) => void; context?: string }) {
  return <details className="guide-help"><summary>این یعنی چه؟</summary><p>{help[topic]}</p><button type="button" className="text-action" onClick={() => onAsk(help[topic] + (context ? ' اطلاعات فعلی پروژه: ' + context + '.' : '') + ' برای پروژهٔ من چه گزینه‌ای مناسب است؟')}>از دستیار دربارهٔ این گزینه بپرسید</button></details>;
}
export function DeploymentGuide({ appId, disabled, onBusy, onAsk, onHealth }: { appId?: string; disabled: boolean; onBusy: (value: boolean) => void; onAsk: (question: string) => void; onHealth: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [sourceKind, setSourceKind] = useState<SourceKind>('zip');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [zip, setZip] = useState<ZipSummary | null>(null);
  const [zipError, setZipError] = useState('');
  const [options, setOptions] = useState<TestAppOptions | null>(null);
  const [optionError, setOptionError] = useState('');
  const [pending, setPending] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [port, setPort] = useState('3000');
  const [framework, setFramework] = useState('');
  useEffect(() => {
    if (!options) return;
    const remaining = 300000 - (Date.now() - Date.parse(options.fetchedAt));
    const timer = setTimeout(() => { setOptions(null); setSelectedPlan(''); setSelectedNetwork(''); setOptionError('اطلاعات حساب منقضی شد. برای تصمیم‌گیری دوباره آن را بخوانید.'); }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [options]);
  async function chooseZip(file: File | undefined) {
    setZip(null); setZipError(''); setFileName(''); setFileSize(0);
    if (!file) return;
    setFileName(file.name); setFileSize(file.size);
    if (!file.name.toLowerCase().endsWith('.zip')) { setZipError('یک فایل با پسوند ZIP انتخاب کنید.'); return; }
    if (file.size > 25 * 1024 * 1024) { setZipError('برای بررسی محلی، ZIP باید کوچک‌تر از ۲۵ مگابایت باشد.'); return; }
    try { setZip(inspectZipDirectory(new Uint8Array(await file.arrayBuffer()))); }
    catch (e) { setZipError((e as Error).message); }
  }
  async function readOptions() {
    if (pending || disabled) return;
    setPending(true); onBusy(true); setOptionError(''); setOptions(null);
    try {
      const result = await request<TestAppOptions>('/api/liara/test-options', 'POST', {});
      setOptions(result); setSelectedPlan(result.plans[0]?.id ?? ''); setSelectedNetwork('');
    } catch (e) { setOptionError('اطلاعات پلن و شبکه دریافت نشد. اتصال لیارا و حساب انتخابی را بررسی کنید. ' + (e as Error).message); }
    finally { setPending(false); onBusy(false); }
  }
  const plan = options?.plans.find(row => row.id === selectedPlan);
  const network = options?.networks.find(row => row.id === selectedNetwork);
  const steps: { number: Step; label: string }[] = [{ number: 1, label: 'منبع پروژه' }, { number: 2, label: 'شناخت پروژه' }, { number: 3, label: 'تنظیمات' }, { number: 4, label: 'بازبینی و اجرا' }];
  return <section className="guide" aria-label="راهنمای استقرار دستی">
    <div className="guide-intro"><div><h1>وب‌سایتت را با اطمینان منتشر کن</h1><p>در هر مرحله انتخاب‌ها را توضیح می‌دهیم. انتشار نهایی با خودت و در کنسول لیارا است.</p></div><span className="provenance-tag">راهنمای محلی · بدون استقرار خودکار</span></div>
    <nav className="guide-steps" aria-label="مراحل استقرار">{steps.map(item => <button type="button" key={item.number} className={step === item.number ? 'active' : ''} aria-current={step === item.number ? 'step' : undefined} onClick={() => setStep(item.number)}><span>{item.number.toLocaleString('fa-IR')}</span>{item.label}</button>)}</nav>
    {step === 1 && <div className="guide-surface"><h2>سورس وب‌سایت کجاست؟</h2><p className="guide-muted">فایلی که اینجا انتخاب می‌کنی از مرورگر به کوپایلوت ارسال نمی‌شود.</p>
      <div className="choice-row"><label className={sourceKind === 'zip' ? 'choice selected' : 'choice'}><input type="radio" name="source-kind" checked={sourceKind === 'zip'} onChange={() => setSourceKind('zip')}/><strong>فایل ZIP</strong><small>برای بارگذاری دستی در کنسول</small></label><label className={sourceKind === 'github' ? 'choice selected' : 'choice'}><input type="radio" name="source-kind" checked={sourceKind === 'github'} onChange={() => setSourceKind('github')}/><strong>مخزن GitHub</strong><small>برای خواندن اطلاعات نسخهٔ مخزن مجاز</small></label></div>
      {sourceKind === 'zip' ? <div className="guide-field"><label htmlFor="project-zip">فایل ZIP پروژه</label><input id="project-zip" className="file-input" type="file" accept=".zip,application/zip" onChange={e => void chooseZip(e.target.files?.[0])}/><label className="upload-trigger" htmlFor="project-zip">انتخاب فایل ZIP از رایانه</label>{fileName && <p><bdi>{fileName}</bdi> · {fileSize < 1024 * 1024 ? (fileSize / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 0 }) + ' کیلوبایت' : (fileSize / 1024 / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 }) + ' مگابایت'} · فقط بررسی محلی نام فایل‌ها</p>}{zipError && <p role="alert" className="guide-error">{zipError}</p>}</div> : <div className="guide-inline"><p>اتصال GitHub موجود برای برنامه‌ای که قبلاً از حساب تأییدشده انتخاب شده باشد در دسترس است. این اتصال، مجوز انتشار نیست.</p>{appId ? <SourcePanel appId={appId} disabled={disabled}/> : <button className="button secondary" onClick={onHealth}>انتخاب برنامه از حساب لیارا</button>}</div>}
      <Help topic="source" onAsk={onAsk}/>
    </div>}
    {step === 2 && <div className="guide-surface"><h2>چه چیزی از پروژه می‌دانیم؟</h2>
      {sourceKind === 'zip' && zip ? <div className="guide-result"><strong>{zip.runtime}</strong><p>{zip.reason} تعداد فایل‌های عادی: {zip.files.toLocaleString('fa-IR')}.</p><small>بررسی محلی اولیه · محتوا، دستور build و سازگاری اجرا هنوز تأیید نشده‌اند.</small></div> : <p className="guide-empty">{sourceKind === 'zip' ? 'برای تشخیص اولیه، در مرحلهٔ قبل ZIP را انتخاب کن.' : 'پس از اتصال مخزن مجاز، اطلاعات نسخه در همان بخش نمایش داده می‌شود. نوع runtime هنوز در این راهنما تأیید نشده است.'}</p>}
      <div className="guide-field"><label htmlFor="runtime-choice">نوع اجرا برای بازبینی در کنسول</label><select id="runtime-choice" value={framework} onChange={e => setFramework(e.target.value)}><option value="">هنوز انتخاب نشده</option><option value="node">Node.js</option><option value="static">سایت ایستا</option><option value="python">Python</option><option value="other">سایر / نیازمند بررسی</option></select><small>این انتخاب فقط در خلاصهٔ راهنما می‌آید و تنظیمات لیارا را تغییر نمی‌دهد.</small></div><Help topic="runtime" context={zip?.runtime} onAsk={onAsk}/>
    </div>}
    {step === 3 && <div className="guide-surface"><h2>تنظیمات پیشنهادی را بررسی کن</h2><p className="guide-muted">پلن و شبکه فقط از حساب لیارای انتخابی خوانده می‌شوند. چیزی در ابر ساخته نمی‌شود.</p><button type="button" className="button secondary" disabled={disabled || pending} onClick={() => void readOptions()}>{pending ? 'در حال خواندن…' : 'خواندن پلن‌ها و شبکه‌های واقعی'}</button>{optionError && <p role="alert" className="guide-error">{optionError}</p>}
      {options && <><p className="guide-provenance">دادهٔ زندهٔ API لیارا · {new Date(options.fetchedAt).toLocaleString('fa-IR')} · حساب {options.scope?.kind === 'team' ? 'تیم' : 'شخصی'}</p><div className="config-grid"><div className="guide-field"><label htmlFor="plan-choice">پلن</label><select id="plan-choice" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)}><option value="">انتخاب نشده</option>{options.plans.map(row => <option key={row.id} value={row.id}>{row.id} · {row.ramGB} GB RAM · {row.cpuCores} CPU</option>)}</select>{plan && <small>{plan.id === options.plans[0]?.id ? 'کوچک‌ترین پلن موجود؛ پیشنهاد آغاز بررسی، نه تضمین ظرفیت.' : 'مقدار RAM و CPU را با نیاز پروژه بسنجید.'} دیسک: {plan.diskGB} GB · منطقه: ایران.</small>}<Help topic="plan" context={plan ? plan.id + '، ' + plan.ramGB + ' GB RAM، ' + plan.cpuCores + ' CPU' : 'پلن هنوز انتخاب نشده'} onAsk={onAsk}/></div><div className="guide-field"><label htmlFor="network-choice">شبکهٔ موجود</label><select id="network-choice" value={selectedNetwork} onChange={e => setSelectedNetwork(e.target.value)}><option value="">هنوز انتخاب نشده</option>{options.networks.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><Help topic="network" context={network?.name ?? 'شبکه هنوز انتخاب نشده'} onAsk={onAsk}/></div></div>{!options.plans.length && <p className="guide-error">پلن سازگار در پاسخ این حساب پیدا نشد؛ از انتخاب حدسی استفاده نکن.</p>}</>}
      <div className="guide-field"><label htmlFor="port-choice">پورت برنامه</label><input id="port-choice" inputMode="numeric" type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)}/><small>پیشنهاد اولیه برای بسیاری از پروژه‌های Node.js: ۳۰۰۰؛ مقدار واقعی باید با برنامه یکسان باشد.</small><Help topic="port" context={'پورت فعلی ' + port} onAsk={onAsk}/></div>
      <details className="guide-advanced"><summary>جزئیات بیشتر پلن، منطقه، ذخیره‌سازی و هزینه</summary><p>منطقهٔ پلن‌های قابل‌نمایش این راهنما ایران است. ظرفیت دیسک از پلن انتخابی می‌آید؛ نیاز به ذخیره‌سازی ماندگار جداگانه باید در کنسول بررسی شود. تنظیمات build به سورس پروژه وابسته‌اند و اینجا تأیید نشده‌اند.</p><Help topic="cost" onAsk={onAsk}/><TestAppPanel disabled={disabled} onBusy={onBusy}/></details>
    </div>}
    {step === 4 && <div className="guide-surface"><h2>پیش از رفتن به کنسول مرور کن</h2><dl className="guide-summary"><div><dt>منبع</dt><dd>{sourceKind === 'zip' ? fileName || 'ZIP هنوز انتخاب نشده' : 'GitHub · اتصال نیازمند برنامهٔ انتخابی'}</dd></div><div><dt>نوع اجرا</dt><dd>{framework || zip?.runtime || 'نیازمند بررسی'}</dd></div><div><dt>پلن</dt><dd>{plan ? plan.id + ' · ' + plan.ramGB + ' GB RAM' : 'از دادهٔ زنده انتخاب نشده'}</dd></div><div><dt>منطقه و شبکه</dt><dd>{plan ? 'ایران' : 'نامشخص'} · {network?.name ?? 'شبکه انتخاب نشده'}</dd></div><div><dt>پورت</dt><dd>{Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535 ? port : 'نامعتبر؛ اصلاح شود'}</dd></div><div><dt>هزینه</dt><dd>مبلغ نهایی نامشخص؛ در کنسول بررسی شود</dd></div></dl>
      <div className="manual-notice"><strong>گام بعدی با شماست</strong><ol className="manual-steps"><li>در کنسول لیارا حساب و برنامهٔ درست را انتخاب کن.</li><li>سورس را همان‌جا بارگذاری کن و تنظیمات را با این خلاصه تطبیق بده.</li><li>هزینه و اثر انتشار را در کنسول بخوان؛ فقط اگر پذیرفتی، انتشار را خودت تأیید کن.</li><li>پس از پایان، به بخش سلامت برگرد و وضعیت واقعی را تازه‌سازی کن.</li></ol><p>کوپایلوت این انتشار را انجام نمی‌دهد و بدون شواهد جدید نتیجه‌ای را موفق اعلام نمی‌کند.</p><div className="manual-actions"><a className="button primary" href="https://console.liara.ir/" target="_blank" rel="noopener noreferrer">باز کردن کنسول لیارا</a><button type="button" className="button secondary" onClick={onHealth}>پس از انتشار، بررسی سلامت</button></div></div><Help topic="cost" onAsk={onAsk}/>
    </div>}
    <div className="guide-footer"><button className="button secondary" disabled={step === 1} onClick={() => setStep((step - 1) as Step)}>مرحلهٔ قبل</button><span>مرحلهٔ {step.toLocaleString('fa-IR')} از ۴</span><button className="button primary" disabled={step === 4} onClick={() => setStep((step + 1) as Step)}>مرحلهٔ بعد</button></div>
  </section>;
}
