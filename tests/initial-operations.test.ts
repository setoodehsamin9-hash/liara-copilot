import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {Operations} from '../server/operations.js';
import {archiveDigest} from '../server/deployment.js';
const success={command:'trusted smoke',exitCode:0,stdout:'',stderr:'',startedAt:'2026-10-23T00:00:00Z',finishedAt:'2026-10-23T00:00:01Z',timedOut:false,testSummary:{complete:true,total:3,passed:3,failed:0}};
const evidence={kind:'intentional-http500-baseline-v1' as const,revision:'sha256:baseline',smoke:success,regression:{...success,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},http:[{path:'/',status:200},{path:'/health',status:200},{path:'/api/checkout',status:500}],diff:'initial source addition'};
const target={accountId:'000000000000000000000001:team:000000000000000000000002',appId:'liara-copilot-test-20261022',projectId:'000000000000000000000003',currentRelease:null};
test('MOCK INITIAL: new grant binds intentional failure and exact team/app; never dispatches during prepare',()=>{
 const store=new Store(':memory:');try{
  const operations=new Operations(store);const bytes=new Uint8Array([1,2]);let calls=0;
  const input={initial:evidence,target,artifact:{bytes,digest:archiveDigest(bytes),revision:evidence.revision,manifest:['app.mjs']},parameters:{port:3000,type:'node',platformConfig:{version:'22' as const}},fixture:false,check:async()=>{},execute:async()=>{calls++;}};
  const view=operations.prepare(input,'human');assert.equal(view.state,'pending');assert.equal(view.purpose,'initial-http500-baseline');assert.equal(view.initialRegression?.exitCode,1);assert.equal(calls,0);
  assert.match(view.impact,/500/);assert.equal((store.db.prepare('SELECT state FROM approvals WHERE id=?').get(view.id) as {state:string}).state,'pending');
 }finally{store.close();}
});
test('MOCK INITIAL: rejects failed smoke, wrong account/project, existing release, wrong runtime and fake HTTP proof',()=>{
 for(const mode of ['smoke','account','project','release','runtime','http']){
  const store=new Store(':memory:');try{const operations=new Operations(store),bytes=new Uint8Array([1]);
   const input={initial:structuredClone(evidence),target:{...target},artifact:{bytes,digest:archiveDigest(bytes),revision:evidence.revision,manifest:['app.mjs']},parameters:{port:3000,type:'node',platformConfig:{version:'22'}},fixture:false,check:async()=>{},execute:async()=>{throw Error('must not dispatch');}};
   if(mode==='smoke')input.initial.smoke.exitCode=1;if(mode==='account')input.target.accountId='personal';if(mode==='project')input.target.projectId='other';if(mode==='release')(input.target as {currentRelease:string|null}).currentRelease='existing';if(mode==='runtime')input.parameters.platformConfig.version='26';if(mode==='http')input.initial.http[2]!.status=200;
   assert.throws(()=>operations.prepare(input,'human'));
  }finally{store.close();}
 }
});
