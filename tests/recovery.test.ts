import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Store} from '../server/store.js';
import {Operations} from '../server/operations.js';
import {archiveDigest} from '../server/deployment.js';
import {LiaraDeployment} from '../server/deployment.js';
import type {RepairView} from '../server/repair-types.js';

const command={command:'FIXTURE',exitCode:0,stdout:'',stderr:'',startedAt:'2026-10-22T00:00:00Z',finishedAt:'2026-10-22T00:00:01Z',timedOut:false,testSummary:{complete:true,total:1,passed:1,failed:0}};
const repair:RepairView={id:'fixture',label:'FIXTURE',fixture:true,state:'review',sourceRevision:'sha256:base',revision:'sha256:tested',branch:'fixture',files:['app.mjs'],diff:'PRIVATE_SOURCE_DIFF_NOT_FOR_SQLITE',summary:'FIXTURE',beforeTests:{...command,exitCode:1},afterTests:command,regressionBefore:{...command,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},events:[]};
const target={accountId:'fixture-owner',appId:'fixture-app',projectId:'fixture-project',currentRelease:'before'};
function input(execute:Parameters<Operations['prepare']>[0]['execute']){const bytes=new Uint8Array([1,2,3]);return {repair,target,artifact:{bytes,digest:archiveDigest(bytes),revision:repair.revision!,manifest:['app.mjs']},parameters:{port:3000,type:'node'},fixture:true,check:async()=>{},execute};}

test('restart invalidates old pending reviews while preserving non-secret operation metadata',()=>{
 const path=resolve('.local','recovery-'+randomUUID()+'.sqlite');let store=new Store(path);
 const proposal=new Operations(store).prepare(input(async()=>({state:'released'})),'old-session');store.close();store=new Store(path);
 try{
  const recovered=new Operations(store);let view:ReturnType<Operations['get']>|undefined;
  assert.doesNotThrow(()=>{view=recovered.get(proposal.id,'new-session');});
  assert.equal(view!.state,'invalidated');assert.equal(view!.reviewNonce,'');assert.equal(view!.artifactDigest,proposal.artifactDigest);
  assert.equal(view!.diff,'');assert.equal((store.db.prepare('SELECT state FROM operations WHERE id=?').get(proposal.id) as {state:string}).state,'invalidated');
  assert.throws(()=>recovered.reject(proposal.id,proposal.digest,proposal.reviewNonce,'new-session'));
 }finally{store.close();}
});

test('an interrupted running operation becomes uncertain on restart and retains its durable target lock',async()=>{
 const path=resolve('.local','recovery-running-'+randomUUID()+'.sqlite');let store=new Store(path);const operations=new Operations(store);
 let reached!:()=>void;const dispatched=new Promise<void>(done=>{reached=done;});
 const proposal=operations.prepare(input(async step=>{step('upload_dispatched');reached();await new Promise(()=>{});return {};}),'old-session');
 void operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'old-session');await dispatched;store.close();store=new Store(path);
 try{
  const recovered=new Operations(store);assert.equal((store.db.prepare('SELECT state FROM operations WHERE id=?').get(proposal.id) as {state:string}).state,'uncertain');
  assert.equal(recovered.get(proposal.id,'new-session').lastStep,'upload_dispatched');
  assert.throws(()=>recovered.prepare(input(async()=>({})),'new-session'));
  await assert.rejects(recovered.approve(proposal.id,proposal.digest,proposal.reviewNonce,'old-session'));
  assert.equal((store.db.prepare('SELECT state FROM approvals WHERE id=?').get(proposal.id) as {state:string}).state,'consumed');
 }finally{store.close();}
});
test('reconciliation persists exact confirmation across restart without ever invoking the consumed executor again',async()=>{
 const path=resolve('.local','recovery-confirmed-'+randomUUID()+'.sqlite');let store=new Store(path),calls=0;
 let operations=new Operations(store);const proposal=operations.prepare(input(async step=>{calls++;step('upload_dispatched');step('source_uploaded','source-1');step('release_dispatched');step('release_submitted','release-1');throw new Error('Lost status read');}),'human');
 await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');store.close();store=new Store(path);operations=new Operations(store);
 const adapter=new LiaraDeployment({token:'FIXTURE-ONLY',fetch:async(url,init)=>{
  assert.equal(init?.method,'GET');const path=new URL(String(url)).pathname;
  if(path==='/v1/me')return Response.json({user:{_id:target.accountId}});
  if(path===`/v1/projects/${target.appId}`)return Response.json({project:{_id:target.projectId,project_id:target.appId,type:'node'}});
  if(path==='/v1/releases/release-1')return Response.json({release:{state:'READY',status:'READY'}});
  return Response.json({currentRelease:'release-1',releases:[{_id:'release-1'}]});
 }});
 try{
  const recovered=await operations.reconcile(proposal.id,'new-human',context=>adapter.reconcile(context));
  assert.equal(recovered.state,'confirmed');assert.equal(recovered.recovery?.state,'confirmed');assert.equal(calls,1);
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human'));
  store.close();store=new Store(path);operations=new Operations(store);assert.equal(operations.get(proposal.id,'another-human').recovery?.releaseID,'release-1');
  assert.equal(operations.list()[0]?.state,'confirmed');assert.equal(calls,1);
 }finally{store.close();}
});
test('manual reconciliation preserves the ambiguous target lock; missing receipts never produce a retry path',async()=>{
 const store=new Store(':memory:');const operations=new Operations(store);let calls=0;
 try{
  const proposal=operations.prepare(input(async step=>{calls++;step('upload_dispatched');throw new Error('Unknown outcome');}),'human');await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');
  const result=await operations.reconcile(proposal.id,'human',async()=>({state:'manual',reason:'missing_receipt',checkedAt:new Date().toISOString(),evidence:[]}));
  assert.equal(result.state,'uncertain');assert.equal(result.recovery?.state,'manual');assert.throws(()=>operations.prepare(input(async()=>({})),'human'));
  assert.equal(calls,1);await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human'));
 }finally{store.close();}
});
test('a superseded process is fenced before any next POST and cannot overwrite the reconciled durable state',async()=>{
 const store=new Store(':memory:');let releaseCalls=0,allowNext!:()=>void,uploaded!:()=>void;
 const hold=new Promise<void>(done=>{allowNext=done;}),receipt=new Promise<void>(done=>{uploaded=done;});
 try{
  const first=new Operations(store);const proposal=first.prepare(input(async step=>{step('upload_dispatched');step('source_uploaded','source-1');uploaded();await hold;step('release_dispatched');releaseCalls++;return {}; }),'first');
  const running=first.approve(proposal.id,proposal.digest,proposal.reviewNonce,'first');await receipt;
  const replacement=new Operations(store);
  await replacement.reconcile(proposal.id,'replacement',async()=>({state:'failed',reason:'not_dispatched',checkedAt:new Date().toISOString(),evidence:[]}));
  allowNext();await running;
  assert.equal(releaseCalls,0);assert.equal(replacement.get(proposal.id,'replacement').state,'failed');
 }finally{store.close();}
});
test('an older in-flight reconciliation cannot overwrite a replacement process latest evidence or release its lock',async()=>{
 const store=new Store(':memory:');let finish!:()=>void,started!:()=>void;const blocked=new Promise<void>(done=>{finish=done;}),reading=new Promise<void>(done=>{started=done;});
 try{
  const first=new Operations(store),proposal=first.prepare(input(async step=>{step('upload_dispatched');step('source_uploaded','source-1');step('release_dispatched');step('release_submitted','release-1');throw new Error('Unknown outcome');}),'human');await first.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');
  const oldRead=first.reconcile(proposal.id,'human',async()=>{started();await blocked;return {state:'confirmed',reason:'ready',checkedAt:new Date().toISOString(),evidence:[]};});await reading;
  const next=new Operations(store);await next.reconcile(proposal.id,'new',async()=>({state:'manual',reason:'target_changed',checkedAt:new Date().toISOString(),evidence:[]}));
  finish();await assert.rejects(oldRead);assert.equal(next.get(proposal.id,'new').state,'uncertain');assert.equal(next.get(proposal.id,'new').recovery?.reason,'target_changed');
  assert.throws(()=>next.prepare(input(async()=>({})),'new'));
 }finally{store.close();}
});
test('completed validated release/HTTP evidence survives restart while arbitrary upstream outcome fields are discarded',async()=>{
 const path=resolve('.local','recovery-outcome-'+randomUUID()+'.sqlite');let store=new Store(path);const operations=new Operations(store);
 const outcome={state:'verified',releaseID:'release-1',httpHealth:'passed',fetchedAt:'2026-10-22T18:00:00Z',rawSecret:'DO_NOT_PERSIST'};
 const proposal=operations.prepare(input(async()=>outcome),'human');await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');store.close();store=new Store(path);
 try{const restored=new Operations(store).get(proposal.id,'new');assert.equal((restored.outcome as {httpHealth:string}).httpHealth,'passed');assert.equal(JSON.stringify(restored).includes('DO_NOT_PERSIST'),false);}finally{store.close();}
});
