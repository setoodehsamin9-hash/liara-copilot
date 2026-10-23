import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../server/app.js';
import {Operations} from '../server/operations.js';
import {Store} from '../server/store.js';
import {archiveDigest} from '../server/deployment.js';
import type {Runtime} from '../server/codex.js';
import type {RepairView} from '../server/repair-types.js';
const runtime:Runtime={status:{state:'disconnected',message:'FIXTURE',verifiedConversation:false},async connect(){return this.status;},async chat(){},close(){}};
test('MOCK CLOUD: protected HTTP history reconciles a durably recorded release after restart, without a second mutation',async()=>{
 const origin='http://127.0.0.1:4310',host='127.0.0.1:4310',path=resolve('.local','http-recovery-'+randomUUID()+'.sqlite');let store=new Store(path),operations=new Operations(store),app=createApp(runtime,origin,undefined,undefined,{operations});let calls=0;
 const command={command:'FIXTURE',exitCode:0,stdout:'',stderr:'',startedAt:'fixture',finishedAt:'fixture',timedOut:false,testSummary:{complete:true,total:1,passed:1,failed:0}};
 const repair:RepairView={id:'fixture',label:'FIXTURE',fixture:true,state:'review',sourceRevision:'sha256:base',revision:'sha256:tested',branch:'fixture',files:[],diff:'DO_NOT_PERSIST_DIFF',summary:'FIXTURE',beforeTests:command,afterTests:command,regressionBefore:{...command,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},events:[]};
 try{
  let token=(await app.inject({url:'/api/session',headers:{host}})).json().token;
  const bytes=new Uint8Array([1]);const view=operations.prepare({repair,target:{accountId:'local-fixture',appId:'local-http500',projectId:'fixture-project',currentRelease:'fixture-base'},artifact:{bytes,digest:archiveDigest(bytes),revision:repair.revision!,manifest:[]},fixture:true,parameters:{port:3000,type:'node'},check:async()=>{},execute:async step=>{calls++;step('upload_dispatched');step('source_uploaded','fixture-source');step('release_dispatched');step('release_submitted','fixture-release');throw new Error('Lost read');}},createHash('sha256').update(token).digest('hex'));
  const headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({method:'POST',url:`/api/operations/${view.id}/decision`,headers,payload:{decision:'approve',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true}})).json().state,'uncertain');
  await app.close();store.close();store=new Store(path);operations=new Operations(store);app=createApp(runtime,origin,undefined,undefined,{operations});
  assert.equal((await app.inject({url:'/api/operations',headers:{host}})).statusCode,401);
  token=(await app.inject({url:'/api/session',headers:{host}})).json().token;headers['x-liara-session']=token;
  const history=(await app.inject({url:'/api/operations',headers})).json();assert.equal(history[0].state,'uncertain');assert.equal(JSON.stringify(history).includes(view.reviewNonce),false);assert.equal(JSON.stringify(history).includes('DO_NOT_PERSIST_DIFF'),false);
  assert.equal((await app.inject({method:'POST',url:`/api/operations/${view.id}/reconcile`,headers,payload:{releaseID:'other'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:`/api/operations/${view.id}/reconcile`,headers:{...headers,origin:'https://evil.invalid'},payload:{}})).statusCode,403);
  const reconciled=await app.inject({method:'POST',url:`/api/operations/${view.id}/reconcile`,headers,payload:{}});assert.equal(reconciled.statusCode,200);assert.equal(reconciled.json().state,'confirmed');assert.equal(calls,1);
  assert.equal((await app.inject({method:'POST',url:`/api/operations/${view.id}/decision`,headers,payload:{decision:'approve',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true}})).statusCode,409);
 }finally{await app.close();store.close();}
});
