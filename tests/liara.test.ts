import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiaraObservability, LiaraError, redactSecrets } from '../server/liara.js';

const secret = 'fixture-liara-token-never-real-123456';
const now = () => Date.parse('2026-10-22T15:00:00Z');
const appData = { _id: 'db-id-1', project_id: 'safe-app', type: 'node', status: 'running', scale: 1, envs: [{ key: 'PASSWORD', value: 'env-password-must-not-leak' }] };
function fixture(options: { fail?: string; status?: number; malformed?: boolean; privateKeyLogs?: boolean; team?: boolean; waitDetails?: Promise<void>; clock?: () => number } = {}) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init: init ?? {} });
    if (url.pathname === options.fail) return new Response('upstream-secret-do-not-echo', { status: options.status ?? 503 });
    let body: unknown;
    if (url.pathname === '/v1/me') body = { user: { _id: 'owner-1', fullname: 'Fixture user', storage: { secretKey: 'storage-secret-must-not-leak' } }, ...(options.team ? { team: { _id: 'team-other' } } : {}) };
    else if (url.pathname === '/v1/projects') body = { projects: [appData] };
    else if (url.pathname.endsWith('/logs')) body = options.privateKeyLogs ? ['-----BEGIN PRIVATE KEY-----','private-body-do-not-leak','-----END PRIVATE KEY-----','password=last-secret',JSON.stringify({ password: 'prefix"SNAPSHOT-SECRET-SUFFIX' })].map(message => ({ type: 'stderr', datetime: '2026-10-22T14:59:00Z', message })) : [{ type: 'stderr', datetime: '2026-10-22T14:59:00Z', message: `HTTP 500 password=hunter-two Authorization: Bearer ${secret}` }];
    else if (url.pathname.endsWith('/metrics/cpu') || url.pathname.endsWith('/metrics/memory')) body = options.malformed ? { result: 'unexpected' } : { end: 1792681200, result: [{ applet: 'safe-app-1', values: [[1792681140, '0.25'], [1792681200, 'NaN']] }] };
    else if (url.pathname.endsWith('/releases')) body = { releases: [{ _id: 'release-1', tag: 'v1', state: 'ready', createdAt: '2026-10-22T14:00:00Z', gitInfo: { remote: 'https://secret@github.test/x' } }] };
    else { if (options.waitDetails) await options.waitDetails; body = { project: appData }; }
    return Response.json(body);
  };
  return { calls, service: new LiaraObservability(secret, { fetch: fetcher, now: options.clock ?? now, retryDelayMs: 0 }) };
}

test('read-only connection projects safe account/app fields and authorizes selection from actual list', async () => {
  const { service, calls } = fixture();
  assert.equal((await service.connect()).state, 'connected');
  assert.equal(service.status().account?.id, 'owner-1');
  assert.equal(service.apps().data[0]?.id, 'safe-app');
  assert.throws(() => service.select('../other'));
  assert.throws(() => service.select('other-app'));
  assert.equal(calls.length, 2);
  const serialized = JSON.stringify({ status: service.status(), apps: service.apps() });
  for (const value of [secret, 'env-password-must-not-leak', 'storage-secret-must-not-leak', 'envs', 'storage']) assert.equal(serialized.includes(value), false);
  for (const call of calls) { assert.equal(call.url.origin, 'https://api.liara.ir'); assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); }
});

test('snapshot has authentic provenance, redacted logs, raw metric values/gaps and bounded releases', async () => {
  const { service, calls } = fixture(); await service.connect(); service.select('safe-app');
  const snapshot = await service.refresh();
  assert.equal(snapshot.appId, 'safe-app');
  assert.equal(snapshot.logs.state, 'ok');
  assert.equal(snapshot.cpu.state, 'ok');
  if (snapshot.cpu.state === 'ok') {
    assert.equal(snapshot.cpu.evidence.data[0]?.points[0]?.value, 0.25);
    assert.equal(snapshot.cpu.evidence.data[0]?.points[1]?.value, null);
    assert.equal(snapshot.cpu.evidence.source, 'liara-api');
    assert.equal(snapshot.cpu.evidence.fetchedAt, '2026-10-22T15:00:00.000Z');
  }
  const serialized = JSON.stringify(snapshot);
  for (const value of [secret, 'hunter-two', 'env-password-must-not-leak', 'secret@github', 'Authorization: Bearer fixture']) assert.equal(serialized.includes(value), false);
  assert.match(service.evidencePrompt(snapshot.id), /UNTRUSTED_LIARA_EVIDENCE/);
  assert.match(service.evidencePrompt(snapshot.id), /HTTP 500/);
  assert.throws(() => service.evidencePrompt('forged'));
  service.select('safe-app'); // Explicit reselection invalidates even an earlier same-app snapshot.
  assert.throws(() => service.evidencePrompt(snapshot.id));
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/releases'))[0]?.url.searchParams.get('count'), '10');
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/logs'))[0]?.url.searchParams.get('since'), '2026-10-22T14:30:00.000Z');
});

test('authentication failures are not retried and never echo upstream secrets', async () => {
  const { service, calls } = fixture({ fail: '/v1/me', status: 401 });
  await assert.rejects(service.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'auth_required' && !e.message.includes('upstream-secret'));
  assert.equal(calls.filter(c => c.url.pathname === '/v1/me').length, 1);
  assert.equal(service.status().state, 'auth_required');
});

test('eligible GET failures retry once, malformed metrics stay errors, unsupported releases stay explicit', async () => {
  const { service, calls } = fixture({ fail: '/v1/projects/safe-app/releases', status: 404, malformed: true });
  await service.connect(); service.select('safe-app'); const data = await service.refresh();
  assert.equal(data.releases.state, 'unsupported'); assert.equal(data.cpu.state, 'error');
  const retrying = fixture({ fail: '/v1/me' });
  await assert.rejects(retrying.service.connect());
  assert.equal(retrying.calls.filter(c => c.url.pathname === '/v1/me').length, 2);
  assert.ok(calls.every(c => c.init.method === 'GET'));
});

test('secret redaction handles structured credentials, URLs, JWTs, cookies and private keys', () => {
  const raw = '"api_key":"api-secret-value" password=pass-value Cookie: sid=cookie-secret\npostgres://user:db-password@db.test/x?token=query-secret\neyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signatureValue\n-----BEGIN PRIVATE KEY-----\nprivate-content\n-----END PRIVATE KEY-----';
  const result = redactSecrets(raw, [secret]);
  for (const value of ['api-secret-value','pass-value','cookie-secret','db-password','query-secret','signatureValue','private-content']) assert.equal(result.includes(value), false, value);
  assert.match(result, /REDACTED/);
});

test('missing configuration makes zero calls and does not masquerade as empty account', async () => {
  let calls = 0;
  const service = new LiaraObservability(undefined, { fetch: async () => { calls++; throw new Error('must not call'); } });
  assert.equal(service.status().state, 'unconfigured'); await assert.rejects(service.connect());
  assert.equal(calls, 0); assert.throws(() => service.apps());
});

test('multiline private keys are removed across log rows and evidence remains valid structured JSON', async () => {
  const { service } = fixture({ privateKeyLogs: true }); await service.connect(); service.select('safe-app'); const snapshot = await service.refresh();
  assert.equal(JSON.stringify(snapshot).includes('private-body-do-not-leak'), false);
  assert.equal(JSON.stringify(snapshot).includes('SNAPSHOT-SECRET-SUFFIX'), false);
  const prompt = service.evidencePrompt(snapshot.id);
  assert.equal(prompt.includes('last-secret'), false);
  assert.equal(prompt.includes('SNAPSHOT-SECRET-SUFFIX'), false);
  const json = prompt.slice(prompt.indexOf('\n{') + 1, prompt.lastIndexOf('\nEND_UNTRUSTED'));
  assert.doesNotThrow(() => JSON.parse(json));
});

test('ambiguous team context is rejected rather than presented as the personal account', async () => {
  const { service } = fixture({ team: true }); await assert.rejects(service.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'unsupported');
  assert.equal(service.status().state, 'error'); assert.throws(() => service.apps());
});

test('evidence expires and in-flight reads cannot repopulate a changed selection', async () => {
  let time = now(); let resume!: () => void;
  const { service } = fixture({ clock: () => time }); await service.connect(); service.select('safe-app'); const snapshot = await service.refresh();
  time += 300001; assert.throws(() => service.evidencePrompt(snapshot.id));
  const deferred = fixture({ waitDetails: new Promise<void>(resolve => { resume = resolve; }) });
  await deferred.service.connect(); deferred.service.select('safe-app'); const refresh = deferred.service.refresh();
  deferred.service.select('safe-app'); resume();
  await assert.rejects(refresh, (e: unknown) => e instanceof LiaraError && e.code === 'scope_changed');
});

test('upstream bodies are bounded and timeout failures never leak transport details', async () => {
  const huge = new LiaraObservability(secret, { fetch: async () => Response.json({ padding: 'x'.repeat(1_048_577) }) });
  await assert.rejects(huge.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'response_limit');
  let attempts = 0;
  const timeout = new LiaraObservability(secret, { timeoutMs: 5, fetch: async (_input, init) => {
    attempts++;
    return new Promise<Response>((_resolve,reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('secret-transport-detail', 'TimeoutError')), { once: true }); });
  } });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeout.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'timeout' && !e.message.includes('secret-transport')); assert.equal(attempts, 2); }
  finally { clearTimeout(keepAlive); }
});

test('failed connection waits for its sibling read before releasing the concurrency guard', async () => {
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const service = new LiaraObservability(secret, { fetch: async input => {
    if (new URL(String(input)).pathname === '/v1/me') return new Response('', { status: 401 });
    await waiting; return Response.json({ projects: [] });
  } });
  const first = service.connect().catch(error => error);
  try {
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(service.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'busy');
  } finally { resume(); await first; }
});

test('an unreadable auth error body cannot turn a 401 into a retryable network error', async () => {
  let calls = 0;
  const service = new LiaraObservability(secret, { retryDelayMs: 0, fetch: async input => {
    if (new URL(String(input)).pathname !== '/v1/me') return Response.json({ projects: [] });
    calls++;
    return new Response(new ReadableStream({ cancel() { throw new Error('fixture body failure'); } }), { status: 401 });
  } });
  await assert.rejects(service.connect(), (e: unknown) => e instanceof LiaraError && e.code === 'auth_required');
  assert.equal(calls, 1);
});

test('JSON-escaped quotes cannot expose recognized credential suffixes', () => {
  const quoted = JSON.stringify({ password: 'first"SECRET-SUFFIX', api_key: 'prefix\\"SECOND-SUFFIX' });
  const result = redactSecrets(quoted);
  assert.equal(result.includes('SECRET-SUFFIX'), false);
  assert.equal(result.includes('SECOND-SUFFIX'), false);
});
