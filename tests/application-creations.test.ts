import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Store} from '../server/store.js';
import {ApplicationCreations,LiaraApplicationCreation} from '../server/application-creations.js';
import {Operations} from '../server/operations.js';
import {archiveDigest} from '../server/deployment.js';
import type {RepairView} from '../server/repair-types.js';

const name='liara-copilot-test-20261022',account='000000000000000000000001',network='000000000000000000000005';
const input={name,networkId:network};
function fixture(options:{existing?:boolean;lost?:boolean;status?:number;appear?:boolean;unreadable?:boolean;incomplete?:boolean}={}){
 let exists=options.existing??false,posts=0,owner=account,networkId=network,price=659.72,projectId='application-1',readable=!options.unreadable;
 let pause:(()=>Promise<void>)|undefined,onPost:(()=>void)|undefined;
 const adapter=new LiaraApplicationCreation({token:'FIXTURE-PRIVATE-CREDENTIAL',fetch:async(raw,init)=>{
  const url=new URL(String(raw));assert.equal(url.origin,'https://api.liara.ir');assert.equal(init?.redirect,'error');
  if(init?.method==='POST'){
   posts++;onPost?.();assert.equal(url.pathname,'/v1/projects');
   assert.deepEqual(JSON.parse(String(init.body)),{name,platform:'node',planID:'small-g2',bundlePlanID:'basic',network,readOnlyRootFilesystem:true});
   exists=options.appear??((options.status??200)===200);
   if(options.lost)throw new Error('DO_NOT_LEAK transport');
   return new Response('DO_NOT_LEAK upstream body',{status:options.status??200});
  }
  assert.equal(init?.method,'GET');
  if(url.pathname==='/v1/me')return Response.json({user:{_id:owner,storage:{secretKey:'DO_NOT_LEAK'}},plans:{projects:{'small-g2':{available:true,region:'iran',RAM:{amount:0.5},CPU:{amount:0.5},volume:5,price}},projectBundlePlans:{'small-g2':{basic:{available:true,displayPrice:275000}}}}});
  if(url.pathname==='/v1/networks')return Response.json({networks:[{_id:networkId,name}]});
  if(posts&&!readable)throw new Error('DO_NOT_LEAK read unavailable');
  const project={_id:projectId,project_id:name,type:'node',planID:'small-g2',bundlePlanID:'basic',network:{_id:network,name},readOnlyRootFilesystem:true,status:'Creating',isDeployed:false,created_at:'2026-10-22T19:00:00Z',envs:{secret:'DO_NOT_LEAK'}};
  if(url.pathname==='/v1/projects'){
   const body={projects:exists?[project]:[]};const wait=pause;pause=undefined;if(wait)await wait();return Response.json(body);
  }
  assert.equal(url.pathname,'/v1/projects/'+name);
  return Response.json({project:options.incomplete?{...project,network:undefined}:project});
 }});
 return {adapter,posts:()=>posts,setOwner:(v:string)=>{owner=v;},setNetwork:(v:string)=>{networkId=v;},setPrice:(v:number)=>{price=v;},setProjectId:(v:string)=>{projectId=v;},remove:()=>{exists=false;},allowReads:()=>{readable=true;},pauseNext:(fn:()=>Promise<void>)=>{pause=fn;},onPost:(fn:()=>void)=>{onPost=fn;}};
}

test('MOCK APP: only an exact independent human grant is consumed durably before the single POST; safe readback verifies configuration',async()=>{
 const f=fixture(),store=new Store(':memory:'),operations=new ApplicationCreations(store,f.adapter);
 try{
  const proposal=await operations.prepare(input,'human');assert.equal(proposal.state,'pending');assert.equal(f.posts(),0);assert.equal(proposal.cost.finalKnown,false);
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'model',true));
  await assert.rejects(operations.approve(proposal.id,'0'.repeat(64),proposal.reviewNonce,'human',true));
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',false));
  f.onPost(()=>{assert.equal(operations.get(proposal.id,'human').attempts,1);assert.equal((store.db.prepare('SELECT state FROM approvals WHERE id=?').get(proposal.grantID) as {state:string}).state,'consumed');});
  const result=await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true);
  assert.equal(result.state,'confirmed');assert.equal(result.applicationId,'application-1');assert.equal(result.attempts,1);assert.equal(result.postStatus,200);assert.equal(result.configurationVerified,true);
  assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'),false);assert.equal(JSON.stringify(f.adapter).includes('FIXTURE-PRIVATE-CREDENTIAL'),false);
  assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM application_creations').all()).includes(proposal.reviewNonce),false);
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));assert.equal(f.posts(),1);
 }finally{store.close();}
});

test('MOCK APP: existing target, changed account/network/price, expiry and rejection never dispatch',async()=>{
 for(const mode of ['existing','account','network','price','expiry','reject']){
  const f=fixture({existing:mode==='existing'}),store=new Store(':memory:');let now=Date.now();const operations=new ApplicationCreations(store,f.adapter,()=>now);
  try{
   const proposal=await operations.prepare(input,'human');
   if(mode==='existing'){assert.equal(proposal.state,'existing');assert.equal(proposal.applicationId,'application-1');}
   if(mode==='account')f.setOwner('another-account');if(mode==='network')f.setNetwork('another-network');if(mode==='price')f.setPrice(700);if(mode==='expiry')now=proposal.expires;
   if(mode==='reject')operations.reject(proposal.id,proposal.digest,proposal.reviewNonce,'human');
   await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));assert.equal(f.posts(),0);
  }finally{store.close();}
 }
});

test('MOCK APP: lost response with a matching app remains unattributed, unavailable reads recover without any retry, failed POST stays single-attempt',async()=>{
 for(const options of [{lost:true,appear:true,unreadable:true},{status:402,appear:false},{status:200,incomplete:true}]){
  const f=fixture(options),store=new Store(':memory:'),operations=new ApplicationCreations(store,f.adapter);
  try{
   const proposal=await operations.prepare(input,'human');const result=await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true);
   assert.equal(result.state,options.status===402?'failed':'uncertain');f.allowReads();const next=await operations.reconcile(proposal.id,'human');
   assert.equal(next.state,options.status===402?'failed':'uncertain');assert.equal(f.posts(),1);
   if(options.lost)assert.equal(next.reason,'present_unattributed');
   assert.equal((await operations.prepare(input,'human')).attempts,1);assert.equal(f.posts(),1);
  }finally{store.close();}
 }
});

test('MOCK APP: concurrent decisions and process restart cannot reuse an approval or recreate a known/removed/replaced application',async()=>{
 const path=resolve('.local','application-creation-'+randomUUID()+'.sqlite'),f=fixture();let store=new Store(path),operations=new ApplicationCreations(store,f.adapter);
 const proposal=await operations.prepare(input,'human');const decisions=await Promise.allSettled([operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true),operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true)]);
 assert.equal(decisions.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.posts(),1);store.close();
 store=new Store(path);operations=new ApplicationCreations(store,f.adapter);
 try{
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));
  f.setProjectId('replacement');const changed=await operations.reconcile(proposal.id,'human');assert.equal(changed.state,'uncertain');assert.equal(changed.applicationId,'application-1');
  f.remove();const absent=await operations.prepare(input,'human');assert.equal(absent.state,'uncertain');assert.equal(absent.applicationId,'application-1');assert.equal(f.posts(),1);
 }finally{store.close();}
});

test('MOCK APP: superseded process and stale reconciliation cannot overwrite newer evidence',async()=>{
 const f=fixture(),store=new Store(':memory:'),old=new ApplicationCreations(store,f.adapter);
 try{
  const proposal=await old.prepare(input,'human');await old.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true);
  let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  f.pauseNext(async()=>{started();await new Promise<void>(resolve=>{release=resolve;});});
  const stale=old.reconcile(proposal.id,'human');await waiting;
  const current=new ApplicationCreations(store,f.adapter);f.setProjectId('replacement');assert.equal((await current.reconcile(proposal.id,'human')).state,'uncertain');
  release();await stale.catch(()=>{});assert.equal(current.get(proposal.id,'human').state,'uncertain');
  await assert.rejects(old.prepare(input,'human'));assert.equal(f.posts(),1);
 }finally{store.close();}
});

test('MOCK APP: pending creation conflicts with deployment and active deployment blocks creation through the shared SQLite boundary',async()=>{
 const f=fixture(),store=new Store(':memory:');let now=Date.now();const deployments=new Operations(store,()=>now),creations=new ApplicationCreations(store,f.adapter,()=>now);
 const command={command:'FIXTURE',exitCode:0,stdout:'',stderr:'',startedAt:'2026-10-22T00:00:00Z',finishedAt:'2026-10-22T00:00:01Z',timedOut:false,testSummary:{complete:true,total:1,passed:1,failed:0}};
 const repair={id:'fixture-repair',label:'FIXTURE',fixture:true,state:'review',sourceRevision:'sha256:base',revision:'sha256:tested',branch:'fixture',files:['app.mjs'],diff:'-500\n+200',summary:'FIXTURE',beforeTests:{...command,exitCode:1},afterTests:command,regressionBefore:{...command,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},events:[]} as RepairView;
 const bytes=new Uint8Array([1,2,3]);
 const deploy=()=>deployments.prepare({repair,target:{accountId:account,appId:name,projectId:'app-1',currentRelease:null},artifact:{bytes,digest:archiveDigest(bytes),revision:repair.revision!,manifest:['app.mjs']},parameters:{port:3000,type:'node'},fixture:true,check:async()=>{},execute:async()=>({})},'human');
 try{
  const proposal=await creations.prepare(input,'human');assert.throws(deploy);creations.reject(proposal.id,proposal.digest,proposal.reviewNonce,'human');
  const deployment=deploy();await assert.rejects(creations.prepare(input,'human'));assert.equal(f.posts(),0);
  deployments.reject(deployment.id,deployment.digest,deployment.reviewNonce,'human');const next=await creations.prepare(input,'human');assert.equal(next.state,'pending');
  now=next.expires;assert.equal(deploy().state,'pending'); // No creation GET is needed to release its expired proposal lock.
 }finally{store.close();}
});

test('MOCK APP: interrupted dispatch and old pending grants stay locked/invalidated across process replacement',async()=>{
 for(const dispatched of [false,true]){const f=fixture(),store=new Store(':memory:'),old=new ApplicationCreations(store,f.adapter);
  try{
   const proposal=await old.prepare(input,'human');
   if(dispatched)store.db.prepare("UPDATE application_creations SET state='dispatched',attempts=1 WHERE id=?").run(proposal.id);
   const current=new ApplicationCreations(store,f.adapter);assert.equal(current.get(proposal.id,'human').state,dispatched?'uncertain':'invalidated');
   await assert.rejects(old.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));await assert.rejects(current.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));assert.equal(f.posts(),0);
  }finally{store.close();}
 }
});
