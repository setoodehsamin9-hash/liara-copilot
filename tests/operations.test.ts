import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Operations} from '../server/operations.js';
import {Store} from '../server/store.js';
import {archiveDigest} from '../server/deployment.js';
import type {RepairView} from '../server/repair-types.js';
const command={command:'fixture test',exitCode:0,stdout:'TEST FIXTURE',stderr:'',startedAt:'2026-10-22T00:00:00Z',finishedAt:'2026-10-22T00:00:01Z',timedOut:false,testSummary:{complete:true,total:1,passed:1,failed:0}};
const repair:RepairView={id:'fixture-repair',label:'FIXTURE',fixture:true,state:'review',sourceRevision:'sha256:base',revision:'sha256:tested',branch:'fixture',files:['app.mjs'],diff:'-500\n+200',summary:'FIXTURE',beforeTests:{...command,exitCode:1},afterTests:command,regressionBefore:{...command,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},events:[]};
const target={accountId:'fixture-owner',appId:'fixture-app',projectId:'fixture-project',currentRelease:null};
function setup(){const store=new Store(':memory:');let now=1000,calls=0,valid=true,fail=false;const operations=new Operations(store,()=>now);const bytes=new Uint8Array([1,2,3]);const artifact={bytes,digest:archiveDigest(bytes),revision:repair.revision!,manifest:['app.mjs']};
 return {store,operations,artifact,setNow:(value:number)=>{now=value;},setValid:(value:boolean)=>{valid=value;},setFail:()=>{fail=true;},calls:()=>calls,prepare:(override?:Partial<RepairView>)=>operations.prepare({repair:{...repair,...override},target,artifact,parameters:{port:3000,type:'node'},fixture:true,check:async()=>{if(!valid)throw new Error('Stale source');},execute:async step=>{calls++;assert.equal((store.db.prepare('SELECT state FROM approvals ORDER BY rowid DESC LIMIT 1').get() as {state:string}).state,'consumed');if(fail){step('upload_dispatched');throw new Error('Ambiguous fixture failure');}return {state:'released',releaseID:'fixture-release',httpHealth:'not_configured',fetchedAt:'fixture'};}},'human')};}
test('approval binds exact review/session, prevents conflicting proposals and consumes once before execution',async()=>{
 const f=setup();try{const review=f.prepare();assert.throws(()=>f.prepare());
  await assert.rejects(f.operations.approve(review.id,review.digest,'0'.repeat(64),'human'));
  await assert.rejects(f.operations.approve(review.id,review.digest,review.reviewNonce,'model'));
  assert.equal(f.calls(),0);const result=await f.operations.approve(review.id,review.digest,review.reviewNonce,'human');assert.equal(result.state,'completed');assert.equal(f.calls(),1);
  await assert.rejects(f.operations.approve(review.id,review.digest,review.reviewNonce,'human'));assert.equal(f.calls(),1);
 }finally{f.store.close();}
});
test('the central operation boundary refuses incomplete test evidence and absent regression proof',()=>{
 const f=setup();try{assert.throws(()=>f.prepare({afterTests:{...command,testSummary:undefined}}));assert.throws(()=>f.prepare({regressionBefore:undefined}));assert.equal(f.calls(),0);}finally{f.store.close();}
});
test('concurrent decisions execute only once and uncertain target locks survive a gate restart',async()=>{
 const f=setup();try{const review=f.prepare();const attempts=await Promise.allSettled([f.operations.approve(review.id,review.digest,review.reviewNonce,'human'),f.operations.approve(review.id,review.digest,review.reviewNonce,'human')]);assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(f.calls(),1);}finally{f.store.close();}
 const g=setup();try{const review=g.prepare();g.setFail();const result=await g.operations.approve(review.id,review.digest,review.reviewNonce,'human');assert.equal(result.state,'uncertain');assert.throws(()=>g.prepare());new Operations(g.store);assert.throws(()=>g.prepare());assert.equal(g.calls(),1);}finally{g.store.close();}
});
test('expiry, source drift, artifact tampering and rejection all prevent mutation',async()=>{
 for(const mode of ['expiry','source','artifact','reject']){const f=setup();try{const review=f.prepare();
  if(mode==='expiry')f.setNow(review.expires);if(mode==='source')f.setValid(false);if(mode==='artifact')f.artifact.bytes[0]=9;
  if(mode==='reject')f.operations.reject(review.id,review.digest,review.reviewNonce,'human');
  await assert.rejects(f.operations.approve(review.id,review.digest,review.reviewNonce,'human'));assert.equal(f.calls(),0);
 }finally{f.store.close();}}
});
