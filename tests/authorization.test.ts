import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalGate, actionDigest, assertReadOnlyCapability, type CloudAction } from '../server/authorization.js';
import { Store } from '../server/store.js';

const action: CloudAction = { kind: 'deploy', accountId: 'account-1', targetId: 'app-1', revision: 'sha256:artifact-1', parameters: { replicas: 1, nested: { b: 2, a: 1 } } };
test('approval binds all action fields, human principal, expiry, and one-time consumption', () => {
  const store = new Store(':memory:'); let now = 1000; const gate = new ApprovalGate(store, () => now);
  try {
    const proposal = gate.prepare(action, 'human-session-1');
    assert.throws(() => gate.consume(proposal.id, action, 'human-session-1'));
    assert.throws(() => gate.confirm(proposal.id, proposal.digest, 'model'));
    assert.throws(() => gate.confirm(proposal.id, 'tampered', 'human-session-1'));
    gate.confirm(proposal.id, proposal.digest, 'human-session-1');
    for (const changed of [{ ...action, targetId: 'other' }, { ...action, accountId: 'other' }, { ...action, kind: 'restart' as const }, { ...action, revision: 'sha256:other' }, { ...action, parameters: { replicas: 2 } }]) assert.throws(() => gate.consume(proposal.id, changed, 'human-session-1'));
    assert.throws(() => gate.consume(proposal.id, action, 'human-session-after-restart'));
    gate.consume(proposal.id, action, 'human-session-1');
    assert.throws(() => gate.consume(proposal.id, action, 'human-session-1'));
    const oldGrant = gate.prepare(action, 'human-session-1'); gate.confirm(oldGrant.id, oldGrant.digest, 'human-session-1');
    assert.throws(() => new ApprovalGate(store, () => now).consume(oldGrant.id, action, 'human-session-1'));
    const expiring = gate.prepare(action, 'human-session-1');
    gate.confirm(expiring.id, expiring.digest, 'human-session-1');
    now = expiring.expires;
    assert.throws(() => gate.consume(expiring.id, action, 'human-session-1'));
    const unconfirmed = gate.prepare(action, 'human-session-1'); now = unconfirmed.expires;
    assert.throws(() => gate.confirm(unconfirmed.id, unconfirmed.digest, 'human-session-1'));
  } finally { store.close(); }
});
test('canonical digest is stable for reordered JSON and rejects unrecognized fields', () => {
  assert.equal(actionDigest(action), actionDigest({ ...action, parameters: { nested: { a: 1, b: 2 }, replicas: 1 } }));
  assert.throws(() => actionDigest({ ...action, extra: 'unbound' } as CloudAction));
});
test('Phase 2 enables read-only diagnostics and chat while denying all writes', () => {
  assert.doesNotThrow(() => assertReadOnlyCapability('chat'));
  assert.doesNotThrow(() => assertReadOnlyCapability('diagnostics'));
  for (const capability of ['source_write','cloud_mutation'] as const) assert.throws(() => assertReadOnlyCapability(capability));
});
test('competing consumers cannot replay an approved proposal', async () => {
  const store = new Store(':memory:'); const gate = new ApprovalGate(store);
  try {
    const proposal = gate.prepare(action, 'human'); gate.confirm(proposal.id, proposal.digest, 'human');
    const results = await Promise.allSettled([Promise.resolve().then(() => gate.consume(proposal.id, action, 'human')), Promise.resolve().then(() => gate.consume(proposal.id, action, 'human'))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  } finally { store.close(); }
});
test('human rejection permanently prevents later approval and consumption',()=>{
 const store=new Store(':memory:');const gate=new ApprovalGate(store);try{
  const proposal=gate.prepare(action,'human');gate.reject(proposal.id,proposal.digest,'human');
  assert.throws(()=>gate.confirm(proposal.id,proposal.digest,'human'));assert.throws(()=>gate.consume(proposal.id,action,'human'));
 }finally{store.close();}
});
