import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import type { Runtime } from '../server/codex.js';
import type { ChatEvent, ConnectionStatus } from '../server/protocol.js';

// TEST ONLY: a deterministic transport fixture does not count as Codex verification.
class FixtureRuntime implements Runtime {
  status: ConnectionStatus = { state: 'disconnected', message: 'test fixture', verifiedConversation: false };
  async connect() { this.status = { ...this.status, state: 'ready' }; return this.status; }
  async chat(_text: string, emit: (e: ChatEvent) => void) { emit({ type: 'delta', text: 'test fixture', itemId: 'test-1' }); emit({ type: 'done', status: 'completed' }); }
  close() {}
}
const origin = 'http://127.0.0.1:4310'; const host = '127.0.0.1:4310';
test('HTTP denies rebinding, cross-site access, missing session, and invalid origin', async () => {
  const app = createApp(new FixtureRuntime(), origin);
  try {
    assert.equal((await app.inject({ url: '/api/session', headers: { host: 'evil.test:4310' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/session', headers: { host, origin: 'https://evil.test' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/session', headers: { host, 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/status', headers: { host } })).statusCode, 401);
    const session = await app.inject({ url: '/api/session', headers: { host } });
    assert.equal(session.headers['cache-control'], 'no-store');
    assert.equal(session.headers['x-frame-options'], 'DENY');
    const token = session.json<{ token: string }>().token;
    const headers = { host, 'x-liara-session': token };
    assert.equal((await app.inject({ method: 'POST', url: '/api/connect', headers })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/connect', headers: { ...headers, origin: 'https://evil.test' } })).statusCode, 403);
    const status = await app.inject({ url: '/api/status', headers });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().capabilities.cloudMutation, false);
    assert.equal(status.json().liara, 'unconfigured');
  } finally { await app.close(); }
});
test('validated chat streams events; paths, commands, generic RPC, cloud routes are unavailable', async () => {
  const app = createApp(new FixtureRuntime(), origin);
  try {
    const token = (await app.inject({ url: '/api/session', headers: { host } })).json<{ token: string }>().token;
    const headers = { host, origin, 'x-liara-session': token };
    assert.equal((await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'hello' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/connect', headers })).statusCode, 200);
    for (const payload of [{ message: '' }, { message: 'x'.repeat(4001) }, { message: 'hello', cwd: 'C:/' }, { message: 'hello', command: 'anything' }]) assert.equal((await app.inject({ method: 'POST', url: '/api/chat', headers, payload })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'x'.repeat(20000) } })).statusCode, 413);
    for (const url of ['/api/deploy','/api/restart','/api/rollback','/api/scale','/api/environment','/api/resources','/api/files','/api/exec','/api/rpc','/api/approvals']) assert.equal((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 404);
    const response = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'hello' } });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /text\/event-stream/);
    assert.match(response.body, /"type":"delta"/);
    assert.match(response.body, /"status":"completed"/);
    assert.match(response.body, /test fixture/);
  } finally { await app.close(); }
});
test('parallel chats are rejected while a turn is active', async () => {
  const runtime = new FixtureRuntime(); let finish: (() => void) | undefined;
  runtime.chat = async (_text, emit) => { await new Promise<void>(resolve => { finish = resolve; }); emit({ type: 'done', status: 'completed' }); };
  await runtime.connect(); const app = createApp(runtime, origin);
  const token = (await app.inject({ url: '/api/session', headers: { host } })).json<{ token: string }>().token;
  const headers = { host, origin, 'x-liara-session': token };
  const first = app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'one' } }).then(r => r);
  try {
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'two' } })).statusCode, 409);
  } finally { finish?.(); await first; await app.close(); }
});
