export type ZipSummary = { files: number; runtime: string; reason: string; names: string[] };
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1500;
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Reads only ZIP directory names in the browser. No extraction, upload, or path handoff. */
export function inspectZipDirectory(bytes: Uint8Array): ZipSummary {
  if (bytes.length < 22 || bytes.length > MAX_BYTES) throw new Error('فایل ZIP باید معتبر و کوچک‌تر از ۲۵ مگابایت باشد.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('ساختار ZIP پشتیبانی نمی‌شود.');
  const count = view.getUint16(end + 10, true);
  const length = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count > MAX_FILES || count === 0 || start === 0xffffffff || length === 0xffffffff || start + length > end) throw new Error('فهرست فایل‌های ZIP معتبر نیست یا بیش از حد بزرگ است.');
  const names: string[] = [];
  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > start + length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('فهرست فایل‌های ZIP ناقص است.');
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (flags & 1 || next > start + length) throw new Error('این ZIP رمزگذاری شده یا نامعتبر است.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').some(part => part === '..') || name.includes('\0')) throw new Error('مسیر ناامن در ZIP پیدا شد.');
    const localOffset = view.getUint32(offset + 42, true);
    const compressedSize = view.getUint32(offset + 20, true);
    if (localOffset + 30 > start || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('دادهٔ ZIP ناقص است.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > start || decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)).replaceAll('\\', '/') !== name) throw new Error('فهرست و دادهٔ ZIP با هم نمی‌خوانند.');
    if (!name.endsWith('/')) names.push(name);
    offset = next;
  }
  if (offset !== start + length) throw new Error('فهرست ZIP با اندازهٔ اعلام‌شده نمی‌خواند.');
  const base = names.map(name => name.toLowerCase());
  const has = (name: string) => base.some(path => path === name || path.endsWith('/' + name));
  let runtime = 'نامشخص';
  let reason = 'از نام فایل‌ها نمی‌توان نوع پروژه را با اطمینان تشخیص داد.';
  if (has('next.config.js') || has('next.config.mjs') || has('next.config.ts')) { runtime = 'احتمالاً Next.js / Node.js'; reason = 'فایل تنظیمات Next.js در ZIP دیده شد.'; }
  else if (has('vite.config.ts') || has('vite.config.js') || has('vite.config.mjs')) { runtime = 'احتمالاً Vite / Node.js'; reason = 'فایل تنظیمات Vite در ZIP دیده شد.'; }
  else if (has('package.json')) { runtime = 'احتمالاً Node.js'; reason = 'فایل package.json در ZIP دیده شد.'; }
  else if (has('requirements.txt') || has('pyproject.toml')) { runtime = 'احتمالاً Python'; reason = 'فایل وابستگی Python در ZIP دیده شد.'; }
  else if (has('index.html')) { runtime = 'احتمالاً سایت ایستا'; reason = 'فایل index.html در ZIP دیده شد.'; }
  return { files: names.length, runtime, reason, names };
}
