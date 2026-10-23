import type { ChatEvent, ConnectionStatus } from '../server/protocol.js';

let token: string | undefined;
let sessionRequest: Promise<string | undefined> | undefined;
async function session() {
  if (!token) {
    sessionRequest ??= (async () => {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('دسترسی به برنامه ممکن نیست. صفحه را دوباره باز کنید.');
      token = (await response.json() as { token: string }).token;
      return token;
    })().finally(() => { sessionRequest = undefined; });
    return sessionRequest;
  }
  return token;
}
export async function request<T>(path: string, method = 'GET', body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, headers: { 'X-Liara-Session': (await session())!, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal });
  if (!response.ok) {
    if (response.status === 401) token = undefined;
    const error = await response.json().catch(() => ({})) as { message?: string };
    if (typeof error.message === 'string') throw new Error(error.message);
    throw new Error(response.status === 409 ? 'یک درخواست در حال اجرا است. کمی صبر کنید.' : 'ارتباط با برنامه برقرار نشد. دوباره تلاش کنید.');
  }
  return response.json() as Promise<T>;
}
export const getStatus = () => request<{ codex: ConnectionStatus }>('/api/status');
export const connect = () => request<{ codex: ConnectionStatus }>('/api/connect', 'POST');

export async function chat(message: string, onEvent: (event: ChatEvent) => void, signal: AbortSignal, evidenceId?: string) {
  return stream('/api/chat',{message,...(evidenceId?{evidenceId}:{})},onEvent,signal);
}
export async function stream<T extends {type:string}>(path:string,body:Record<string,unknown>,onEvent:(event:T)=>void,signal:AbortSignal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Liara-Session': (await session())! }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(error.message ?? (response.status === 409 ? 'Codex آماده نیست یا درخواست دیگری در حال اجرا است.' : 'ارسال پیام ناموفق بود.'));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        for (const line of frame.split('\n')) if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6)) as T;
          if (event.type === 'done') completed = true;
          onEvent(event);
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error('پاسخ پیش از پایان قطع شد. دوباره متصل شوید.');
  } finally { reader.releaseLock(); }
}

export async function download(path:string,filename:string){
  const response=await fetch(path,{headers:{'X-Liara-Session':(await session())!},cache:'no-store'});
  if(!response.ok)throw new Error('فایل آماده نیست؛ نتیجهٔ تعمیر و اعتبار سورس را بررسی کنید.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return response.headers.get('X-Content-SHA256');
}
