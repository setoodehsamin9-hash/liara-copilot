import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexRuntime } from '../server/codex.js';
import { CodexRpc } from '../server/rpc.js';
import { Store } from '../server/store.js';
import type { ChatEvent } from '../server/protocol.js';
import { resolve } from 'node:path';

// TEST ONLY: protocol fixture. Real connectivity is verified by verify:codex.
class FixtureRpc extends CodexRpc {
  authenticated = true; safe = true; unsafeMcp = false; started = false; outcome = 'completed'; calls: { method: string; params: Record<string, unknown> }[] = [];
  override start() { this.started = true; }
  override notify() {}
  override close() {}
  override async request(method: string, raw: unknown): Promise<unknown> {
    const params = raw as Record<string, unknown>; this.calls.push({ method, params });
    if (method === 'initialize') return { userAgent: 'test/0.0.0' };
    if (method === 'account/read') return { account: this.authenticated ? { type: 'chatgpt' } : null, requiresOpenaiAuth: true };
    if (method === 'config/read') return { config: { features: Object.fromEntries(['shell_tool','plugins','apps','hooks','multi_agent','computer_use','browser_use','image_generation','view_image','workspace_dependencies'].map(k => [k, this.safe ? false : true])), mcp_servers: { inherited: {} } } };
    if (method === 'model/list') return { data: [{ model: 'test-model', isDefault: true }] };
    if (method === 'thread/start') return { thread: { id: 'test-thread' }, sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never', model: 'test-model' };
    if (method === 'mcpServerStatus/list') return { data: this.unsafeMcp ? [{ runtimeStatus: 'connected' }] : [], nextCursor: null };
    if (method === 'thread/unsubscribe') return {};
    if (method === 'turn/start') {
      setImmediate(() => {
        if (this.outcome === 'timeout') return;
        if (this.outcome === 'disconnect') { this.emit('disconnect', new Error('lost')); return; }
        if (this.outcome === 'oversized') {
          for (let index = 0; index < 3; index++) this.emit('notification', 'item/completed', { threadId: 'test-thread', item: { type: 'agentMessage', id: 'large-' + index, text: 'x'.repeat(60000) } });
          this.emit('notification', 'turn/completed', { threadId: 'test-thread', turn: { status: 'completed' } }); return;
        }
        if (this.outcome === 'replacement') {
          this.emit('notification', 'item/agentMessage/delta', { threadId: 'test-thread', itemId: 'large', delta: 'x'.repeat(60000) });
          this.emit('notification', 'item/completed', { threadId: 'test-thread', item: { type: 'agentMessage', id: 'large', text: 'x'.repeat(60000) } });
          this.emit('notification', 'turn/completed', { threadId: 'test-thread', turn: { status: 'completed' } }); return;
        }
        this.emit('notification', 'item/agentMessage/delta', { threadId: 'other-thread', itemId: 'other', delta: 'DO NOT LEAK' });
        this.emit('notification', 'item/agentMessage/delta', { threadId: 'test-thread', itemId: 'test-item', delta: 'fixture answer' });
        this.emit('notification', 'turn/completed', { threadId: 'test-thread', turn: { status: this.outcome, error: this.outcome === 'failed' ? { message: 'secret-do-not-expose' } : null } });
      });
      return { turn: { id: 'test-turn', status: 'inProgress' } };
    }
    throw new Error('Unexpected request');
  }
}
function fixture() {
  const store = new Store(':memory:'); const rpc = new FixtureRpc();
  const runtime = new CodexRuntime({ executable: 'test-only', cwd: resolve('.local/test-workspace'), store, createRpc: () => rpc, turnTimeoutMs: 50 });
  return { store, rpc, runtime };
}

test('structured diagnosis uses a separate restricted thread and preserves the chat thread',async()=>{
  const f=fixture();try{
    await f.runtime.connect();await f.runtime.chat('chat',()=>{});
    await f.runtime.chat('diagnosis',()=>{},{outputSchema:{type:'object'},isolated:true});
    await f.runtime.chat('chat again',()=>{});
    assert.equal(f.rpc.calls.filter(c=>c.method==='thread/start').length,2);
    assert.equal(f.rpc.calls.filter(c=>c.method==='thread/unsubscribe').length,1);
    const turns=f.rpc.calls.filter(c=>c.method==='turn/start');
    assert.deepEqual(turns[1]?.params.outputSchema,{type:'object'});
    assert.equal(turns[2]?.params.outputSchema,undefined);
  }finally{f.runtime.close();f.store.close();}
});
test('scoped repair tools require an explicit server profile and remain unavailable to normal chat',async()=>{
 const f=fixture();try{
  await f.runtime.connect();const events:ChatEvent[]=[];
  await assert.rejects(f.runtime.chat('unsafe',event=>events.push(event),{isolated:true,tools:[{name:'read_source',description:'scoped',schema:{type:'object'},async run(){return 'safe';}}]}));
  assert.equal(f.rpc.calls.some(call=>call.method==='turn/start'),false);
 }finally{f.runtime.close();f.store.close();}
});
test('closing during initialization prevents a detached process or stale ready status', async () => {
  const f = fixture();
  try {
    const pending = f.runtime.connect(); f.runtime.close(); await pending;
    assert.equal(f.rpc.started, false); assert.equal(f.runtime.status.state, 'disconnected');
  } finally { f.runtime.close(); f.store.close(); }
});
test('authentication-required and unsafe configuration fail closed', async () => {
  const f = fixture();
  try {
    f.rpc.authenticated = false; assert.equal((await f.runtime.connect()).state, 'auth_required');
    await assert.rejects(f.runtime.chat('test', () => {}));
    f.rpc.authenticated = true; f.rpc.safe = false; assert.equal((await f.runtime.connect()).state, 'error');
    assert.equal(f.rpc.calls.some(c => c.method === 'thread/start'), false);
  } finally { f.runtime.close(); f.store.close(); }
});
test('thread locks scope, disables inherited MCP, filters unrelated events and only verifies completed turns', async () => {
  const f = fixture();
  try {
    assert.equal((await f.runtime.connect()).state, 'ready');
    assert.equal(f.runtime.status.verifiedConversation, false);
    const events: ChatEvent[] = []; await f.runtime.chat('test', e => events.push(e));
    assert.equal(f.runtime.status.verifiedConversation, true);
    const params = f.rpc.calls.find(c => c.method === 'thread/start')!.params;
    assert.equal(params.sandbox, 'read-only'); assert.equal(params.approvalPolicy, 'never');
    assert.equal((params.config as Record<string, unknown>)['mcp_servers.inherited.enabled'], false);
    assert.equal(events.some(e => e.type === 'delta' && e.text.includes('LEAK')), false);
  } finally { f.runtime.close(); f.store.close(); }
});
test('unexpected live MCP inventory prevents turn/start', async () => {
  const f = fixture(); f.rpc.unsafeMcp = true;
  try {
    await f.runtime.connect(); const events: ChatEvent[] = []; await f.runtime.chat('test', e => events.push(e));
    assert.equal(f.rpc.calls.some(c => c.method === 'turn/start'), false);
    assert.equal(f.runtime.status.state, 'error');
    assert.equal(events.some(e => e.type === 'error' && e.code === 'unsafe_configuration'), true);
  } finally { f.runtime.close(); f.store.close(); }
});
test('final-only messages count cumulatively and final replacements do not count twice', async () => {
  for (const outcome of ['oversized','replacement']) {
    const f = fixture(); f.rpc.outcome = outcome;
    try {
      await f.runtime.connect(); const events: ChatEvent[] = []; await f.runtime.chat('test', e => events.push(e));
      assert.equal(f.runtime.status.verifiedConversation, outcome === 'replacement');
      if (outcome === 'oversized') {
        assert.equal(events.some(e => e.type === 'error' && e.code === 'output_limit'), true);
        assert.equal(events.filter(e => e.type === 'message').length, 1);
      }
    } finally { f.runtime.close(); f.store.close(); }
  }
});
for (const outcome of ['failed', 'disconnect', 'timeout', 'interrupted']) test(`runtime ${outcome} is never verified as success`, async () => {
  const f = fixture(); f.rpc.outcome = outcome;
  try {
    await f.runtime.connect(); const events: ChatEvent[] = []; await f.runtime.chat('test', e => events.push(e));
    assert.equal(f.runtime.status.verifiedConversation, false);
    assert.equal(events.some(e => e.type === 'done' && e.status === 'completed'), false);
    assert.equal(JSON.stringify(events).includes('secret-do-not-expose'), false);
  } finally { f.runtime.close(); f.store.close(); }
});
