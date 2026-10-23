import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import type { Runtime } from '../server/codex.js';
import { LiaraObservability } from '../server/liara.js';

const host = '127.0.0.1:4310'; const origin = `http://${host}`;
const runtime: Runtime = {
  status: { state: 'disconnected', message: 'fixture', verifiedConversation: false },
  async connect() { return this.status; }, async chat() {}, close() {},
};
test('unconfigured Liara reports honestly without making any cloud request', async () => {
  const app = createApp(runtime, origin);
  try {
    const token = (await app.inject({ url: '/api/session', headers: { host } })).json().token;
    const headers = { host, origin, 'x-liara-session': token };
    const response = await app.inject({ url: '/api/liara/status', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, 'unconfigured');
    assert.equal(response.json().configured, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/liara/connect', headers })).statusCode, 409);
    assert.equal((await app.inject({ url: '/api/liara/status', headers: { host } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/liara/connect', headers: { ...headers, origin: 'https://evil.test' } })).statusCode, 403);
  } finally { await app.close(); }
});

test('selected, server-owned sanitized evidence reaches Codex; client-supplied or stale scope is rejected', async () => {
  let prompt = ''; let calls = 0;
  const tokenSecret = 'fake-only-liara-credential-12345';
  const service = new LiaraObservability(tokenSecret, { fetch: async (input, init) => {
    calls++; assert.equal(init?.method, 'GET');
    const path = new URL(String(input)).pathname;
    if (path === '/v1/me') return Response.json({ user: { _id: 'owner' } });
    if (path === '/v1/projects') return Response.json({ projects: [{ project_id: 'owned-app' }] });
    if (path.endsWith('/logs')) return Response.json([{ type: 'stderr', datetime: '2026-10-22T15:00:00Z', message: `500 token=${tokenSecret}` }]);
    if (path.includes('/metrics/')) return Response.json({ result: [] });
    if (path.endsWith('/releases')) return Response.json({ releases: [] });
    return Response.json({ project: { project_id: 'owned-app', envs: [{ value: 'secret-env' }] } });
  } });
  const ready: Runtime = { ...runtime, status: { ...runtime.status, state: 'ready' }, async chat(text, emit) { prompt = text; emit({ type: 'done', status: 'completed' }); } };
  const app = createApp(ready, origin, service);
  try {
    const token = (await app.inject({ url: '/api/session', headers: { host } })).json().token;
    const headers = { host, origin, 'x-liara-session': token };
    const call = (url: string, payload?: Record<string, unknown>) => app.inject({ method: 'POST', url, headers, ...(payload === undefined ? {} : { payload }) });
    assert.equal((await call('/api/liara/connect')).statusCode, 200);
    const rejected = await call('/api/liara/selection', { appId: 'outside-account' }); assert.equal(rejected.statusCode, 400); assert.equal(calls, 2);
    assert.equal((await call('/api/liara/selection', { appId: 'owned-app' })).statusCode, 200);
    const response = await call('/api/liara/refresh'); assert.equal(response.statusCode, 200); const snapshot = response.json();
    assert.equal(JSON.stringify(snapshot).includes(tokenSecret), false);
    assert.equal((await call('/api/chat', { message: 'علت خطا چیست؟', evidenceId: snapshot.id })).statusCode, 200);
    assert.match(prompt, /UNTRUSTED_LIARA_EVIDENCE/); assert.match(prompt, /owned-app/); assert.equal(prompt.includes(tokenSecret), false); assert.equal(prompt.includes('secret-env'), false);
    await call('/api/chat', { message: 'یک سؤال عمومی' });
    assert.match(prompt, /NO_CURRENT_LIARA_EVIDENCE/);
    assert.equal((await call('/api/chat', { message: 'test', evidence: { forged: true } })).statusCode, 400);
    await call('/api/liara/disconnect');
    assert.equal((await call('/api/chat', { message: 'test', evidenceId: snapshot.id })).statusCode, 409);
    for (const url of ['/api/liara/deploy','/api/liara/restart','/api/liara/exec']) assert.equal((await call(url, {})).statusCode, 404);
  } finally { await app.close(); }
});
