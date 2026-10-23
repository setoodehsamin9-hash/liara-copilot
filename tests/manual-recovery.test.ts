import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {Operations} from '../server/operations.js';
import {ManualRecovery} from '../server/manual-recovery.js';
import {archiveDigest} from '../server/deployment.js';
import {createApp} from '../server/app.js';
import {LiaraObservability} from '../server/liara.js';
import type {Runtime} from '../server/codex.js';
import {scopeSelector} from '../server/scoped-services.js';

const success={command:'trusted smoke',exitCode:0,stdout:'',stderr:'',startedAt:'2026-10-23T00:00:00Z',finishedAt:'2026-10-23T00:00:01Z',timedOut:false,testSummary:{complete:true,total:3,passed:3,failed:0}};
const initial={kind:'intentional-http500-baseline-v1' as const,revision:'sha256:baseline',smoke:success,regression:{...success,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},http:[{path:'/',status:200},{path:'/health',status:200},{path:'/api/checkout',status:500}],diff:'initial source addition'};
const target={accountId:'000000000000000000000001:team:000000000000000000000002',appId:'liara-copilot-test-20261022',projectId:'000000000000000000000003',currentRelease:null};
export async function uncertainFixture(){
 const store=new Store(':memory:');let now=Date.now();const operations=new Operations(store,()=>now),bytes=new Uint8Array([1,2]);
 const view=operations.prepare({initial,target,artifact:{bytes,digest:archiveDigest(bytes),revision:initial.revision,manifest:['app.mjs']},parameters:{port:3000,type:'node',platformConfig:{version:'22'}},fixture:false,check:async()=>{},execute:async step=>{step('upload_dispatched');throw Error('synthetic missing receipt');}},'human');
 await operations.approve(view.id,view.digest,view.reviewNonce,'human');
 const recovery=new ManualRecovery(store,()=>now),before=store.db.prepare('SELECT * FROM operations WHERE id=?').get(view.id);
 return {store,operations,recovery,id:view.id,before,advance:()=>{now+=300_001;}};
}
function request(review:ReturnType<ManualRecovery['review']>,outcome='unknown',digest='a'){
 return {reviewNonce:review.reviewNonce,subject:review.subject,provider:'liara-support',documentDigest:'sha256:'+digest.repeat(64),reportedOutcome:outcome,...(outcome==='source_exists'?{sourceID:'support-source-123'}:{}),acknowledgeAuthority:true};
}
function unchanged(f:Awaited<ReturnType<typeof uncertainFixture>>){
 assert.deepEqual(f.store.db.prepare('SELECT * FROM operations WHERE id=?').get(f.id),f.before);
 assert.equal((f.store.db.prepare('SELECT state FROM approvals WHERE id=?').get(f.id) as {state:string}).state,'consumed');
 assert.throws(()=>f.store.db.prepare("INSERT INTO operations(id,account,target,expires,state) VALUES ('duplicate',?,?,0,'pending')").run(target.accountId,target.appId));
}

for(const [outcome,next] of [['source_exists','verify_source_correlation'],['upload_absent','review_authoritative_absence'],['unknown','request_support_evidence']] as const){
 test('MOCK SUPPORT / REAL SQLITE: '+outcome+' records evidence without changing receipt, approval or lock',async()=>{
  const f=await uncertainFixture();try{
   const review=f.recovery.review(f.id,'human'),body=request(review,outcome);
   const result=f.recovery.record(f.id,'human',body);assert.equal(result.nextAction,next);assert.equal(result.operationState,'uncertain');assert.equal(result.cloudMutationAllowed,false);assert.equal(result.providerAuthenticityVerified,false);
   assert.equal(result.evidence[0]?.reportedOutcome,outcome);assert.throws(()=>f.recovery.record(f.id,'human',body));unchanged(f);
   const reopened=new ManualRecovery(f.store);assert.equal(reopened.review(f.id,'new-session').evidence.length,1);unchanged(f);
  }finally{f.store.close();}
 });
}

test('MOCK SUPPORT: rejects wrong actor/target/scope/digest, expiry, stale reviews, duplicates and arbitrary text',async()=>{
 const f=await uncertainFixture();try{
  const review=f.recovery.review(f.id,'human'),body=request(review);
  assert.throws(()=>f.recovery.record(f.id,'other',body));
  for(const subject of [{...body.subject,accountId:'000000000000000000000001'},{...body.subject,appId:'other'},{...body.subject,projectId:'b'.repeat(24)},{...body.subject,artifactDigest:'sha256:'+'b'.repeat(64)},{...body.subject,actionDigest:'b'.repeat(64)}])assert.throws(()=>f.recovery.record(f.id,'human',{...body,subject}));
  for(const extra of [{rawResponse:'secret'},{token:'secret'},{reportedOutcome:'unknown',sourceID:'must-not-save'},{acknowledgeAuthority:false}])assert.throws(()=>f.recovery.record(f.id,'human',{...body,...extra}));
  f.advance();assert.throws(()=>f.recovery.record(f.id,'human',body));
  const stale=f.recovery.review(f.id,'human'),fresh=f.recovery.review(f.id,'human');f.recovery.record(f.id,'human',request(fresh));
  assert.throws(()=>f.recovery.record(f.id,'human',request(stale,'unknown','b')));
  assert.throws(()=>f.recovery.record(f.id,'human',request(f.recovery.review(f.id,'human'))));unchanged(f);
 }finally{f.store.close();}
});

test('MOCK SUPPORT: conflicting evidence stays manual; no latest-answer success/failure heuristic',async()=>{
 const f=await uncertainFixture();try{
  f.recovery.record(f.id,'human',request(f.recovery.review(f.id,'human'),'source_exists'));
  const result=f.recovery.record(f.id,'human',request(f.recovery.review(f.id,'human'),'upload_absent','b'));
  assert.equal(result.nextAction,'resolve_conflicting_evidence');assert.equal(result.evidence.length,2);unchanged(f);
 }finally{f.store.close();}
});

test('MOCK SUPPORT: replacement process, changed operation and resolved operations reject evidence intake',async()=>{
 const f=await uncertainFixture();try{
  const review=f.recovery.review(f.id,'human');assert.throws(()=>new ManualRecovery(f.store).record(f.id,'human',request(review)));
  f.store.db.prepare('UPDATE operations SET updatedAt=? WHERE id=?').run('2026-10-24T00:00:00Z',f.id);
  assert.throws(()=>f.recovery.record(f.id,'human',request(review)));
  f.store.db.prepare("UPDATE operations SET state='confirmed' WHERE id=?").run(f.id);assert.throws(()=>f.recovery.review(f.id,'human'));
  assert.equal(f.store.db.prepare('SELECT * FROM support_evidence').all().length,0);
 }finally{f.store.close();}
});

test('MOCK CLOUD / REAL HTTP: switching away/back or disconnect invalidates the old evidence review',async()=>{
 const f=await uncertainFixture(),origin='http://127.0.0.1:4310',host='127.0.0.1:4310',teamId='000000000000000000000002';let cloudPosts=0;
 const select=scopeSelector('FIXTURE-CREDENTIAL',f.store,async(input,init)=>{
  if(init?.method!=='GET'){cloudPosts++;throw Error('Forbidden');}
  const url=new URL(String(input));
  return url.pathname==='/v1/me'?Response.json({user:{_id:'000000000000000000000001'},...(url.searchParams.has('teamID')?{team:{_id:teamId}}:{})}):Response.json({projects:[]});
 });
 const next=await select({kind:'team',teamId}),app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,next.liara,undefined,{...next,operations:new Operations(f.store),selectScope:select});
 try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token},base='/api/operations/'+f.id;
  const review=(await app.inject({url:base+'/support-review',headers})).json();assert.ok(review.reviewNonce);
  for(const scope of [{kind:'personal'},{kind:'team',teamId}])assert.equal((await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:scope})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:base+'/support-evidence',headers,payload:request(review)})).statusCode,409);
  const fresh=(await app.inject({url:base+'/support-review',headers})).json();assert.ok(fresh.reviewNonce);
  assert.equal((await app.inject({method:'POST',url:'/api/liara/disconnect',headers,payload:{}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/liara/connect',headers,payload:{}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:base+'/support-evidence',headers,payload:request(fresh)})).statusCode,409);
  assert.equal(cloudPosts,0);unchanged(f);
 }finally{await app.close();f.store.close();}
});

test('REAL LOCAL HTTP / MOCK CLOUD: session/origin/team required; evidence route cannot dispatch or change operation',async()=>{
 const f=await uncertainFixture(),origin='http://127.0.0.1:4310',host='127.0.0.1:4310',teamId='000000000000000000000002';let cloudCalls=0;
 const liara=new LiaraObservability('FIXTURE-CREDENTIAL',{scope:{kind:'team',teamId},fetch:async()=>{cloudCalls++;throw Error('No cloud calls permitted');}});
 const app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,liara,undefined,{operations:new Operations(f.store)});
 try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token},base='/api/operations/'+f.id;
  assert.equal((await app.inject({url:base+'/support-review',headers:{host}})).statusCode,401);
  const review=(await app.inject({url:base+'/support-review',headers})).json();assert.ok(review.reviewNonce);
  const body=request(review,'source_exists');
  assert.equal((await app.inject({method:'POST',url:base+'/support-evidence',headers:{...headers,origin:'https://evil.invalid'},payload:body})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:base+'/support-evidence',headers,payload:{...body,sourceID:'FIXTURE-CREDENTIAL'}})).statusCode,409);
  const response=await app.inject({method:'POST',url:base+'/support-evidence',headers,payload:body});assert.equal(response.statusCode,200);assert.equal(response.json().cloudMutationAllowed,false);
  assert.equal((await app.inject({method:'POST',url:base+'/support-evidence',headers,payload:body})).statusCode,409);
  const restored=f.operations.get(f.id,'human');assert.equal(restored.state,'uncertain');unchanged(f);assert.equal(cloudCalls,0);
 }finally{await app.close();}
 const personal=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,new LiaraObservability(),undefined,{operations:new Operations(f.store)});
 try{
  const token=(await personal.inject({url:'/api/session',headers:{host}})).json().token;
  assert.equal((await personal.inject({url:'/api/operations/'+f.id+'/support-review',headers:{host,origin,'x-liara-session':token}})).statusCode,409);
  unchanged(f);
 }finally{await personal.close();f.store.close();}
});
