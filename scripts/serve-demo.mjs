// Presentation-only server: local static files, no cloud or Codex runtime.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(project, 'dist');
const port = Number(process.env.LIARA_DEMO_PORT ?? 4322);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LIARA_DEMO_PORT');
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/?demo=recording`;
try { await stat(resolve(root, 'index.html')); }
catch { console.error('فایل ساخته‌شده موجود نیست. ابتدا npm run build را اجرا کنید.'); process.exit(1); }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let parsed;
  try { parsed = new URL(request.url ?? '/', origin); } catch { response.writeHead(400); response.end(); return; }
  if (parsed.pathname === '/' && parsed.searchParams.get('demo') !== 'recording') {
    response.writeHead(302, { Location: '/?demo=recording' }); response.end(); return;
  }
  let path;
  try { path = resolve(root, '.' + decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname)); }
  catch { response.writeHead(400); response.end(); return; }
  if (!path.startsWith(root + sep) || parsed.pathname.startsWith('/api/')) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `پورت ${port} در استفاده است. اگر دمو قبلاً باز است، به ${url} بروید؛ یا LIARA_DEMO_PORT را تغییر دهید.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`\nدموی آمادهٔ ضبط لیارا کوپایلوت\n${url}\nسناریوی کامل: ${origin}/demo-script.html\nزمان پخش خودکار: ۴ دقیقه و ۲۰ ثانیه\nبرای توقف سرور: Ctrl+C\n`);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
    browser.on('error', () => console.log(`مرورگر را روی این آدرس باز کنید: ${url}`));
    browser.unref();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
