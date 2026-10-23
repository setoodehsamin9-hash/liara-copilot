import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import type { Runtime } from '../server/codex.js';
import {LiaraObservability} from '../server/liara.js';
import {SourceRegistry} from '../server/sources.js';

test('Phase 3 diagnosis and source routes remain behind session and Liara scope', async () => {
  const runtime: Runtime = { status: { state: 'ready', message: 'test fixture', verifiedConversation: false }, async connect() { return this.status; }, async chat() {}, close() {} };
  const host = '127.0.0.1:4310'; const origin = `http://${host}`; const app = createApp(runtime, origin);
  try {
    const session = (await app.inject({ url: '/api/session', headers: { host } })).json().token;
    const headers = { host, origin, 'x-liara-session': session };
    assert.equal((await app.inject({ url: '/api/sources/candidates', headers })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/diagnosis', headers, payload: { problem: 'http500', evidenceId: '00000000-0000-4000-8000-000000000001', consent: true } })).statusCode, 409);
    assert.equal((await app.inject({ url: '/api/sources/candidates', headers: { host } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/sources/local', headers, payload: { path: 'C:/', consent: true } })).statusCode, 400);
  } finally { await app.close(); }
});

test('TEST FIXTURE: slow GitHub metadata reads are bounded and cannot cross an app scope change',async()=>{
  let release!:()=>void;let entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
  let requests=0;
  const sources=new SourceRegistry({fetch:async()=>{requests++;if(requests===1){entered();await waiting;return Response.json({full_name:'fixture/repo',default_branch:'main'});}return Response.json({commit:{sha:'a'.repeat(40)}});}});
  const liara=new LiaraObservability('fixture-token-not-real',{fetch:async input=>new URL(String(input)).pathname==='/v1/me'?Response.json({user:{_id:'owner'}}):Response.json({projects:[{project_id:'fixture-app'}]})});
  await liara.connect();liara.select('fixture-app');
  const runtime:Runtime={status:{state:'disconnected',message:'fixture',verifiedConversation:false},async connect(){return this.status;},async chat(){},close(){}};
  const host='127.0.0.1:4310',origin=`http://${host}`;const app=createApp(runtime,origin,liara,sources);
  try{
    const token=(await app.inject({url:'/api/session',headers:{host}})).json().token;const headers={host,origin,'x-liara-session':token};
    const call=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url,headers,payload});
    const pending=call('/api/sources/github',{owner:'fixture',repo:'repo',consent:true});void pending.then(()=>{});await started;
    assert.equal((await call('/api/sources/github',{owner:'fixture',repo:'repo',consent:true})).statusCode,409);
    assert.equal((await call('/api/liara/disconnect',{})).statusCode,409);
    release();assert.equal((await pending).statusCode,200);assert.equal(requests,2);
  }finally{release();await app.close();}
});

test('TEST FIXTURE: diagnosis requires consent, streams validated findings, rejects stale snapshots and blocks scope changes',async()=>{
  let scopeResponse=0;let modelCalls=0;let clock=Date.now();let output='';
  const liara=new LiaraObservability('fixture-token-not-real',{now:()=>clock,fetch:async input=>{
    const path=new URL(String(input)).pathname;
    if(path==='/v1/me')return Response.json({user:{_id:'fixture-owner'}});
    if(path==='/v1/projects')return Response.json({projects:[{project_id:'fixture-app'}]});
    if(path.endsWith('/logs'))return Response.json([{type:'stderr',datetime:new Date(clock).toISOString(),message:'HTTP 500 password=fixture-password'}]);
    if(path.includes('/metrics/'))return Response.json({result:[]});
    if(path.endsWith('/releases'))return Response.json({releases:[]});
    return Response.json({project:{project_id:'fixture-app'}});
  }});
  const host='127.0.0.1:4310',origin=`http://${host}`;
  let app:ReturnType<typeof createApp>;let headers:Record<string,string>;
  const runtime:Runtime={status:{state:'ready',message:'fixture',verifiedConversation:false},async connect(){return this.status;},close(){},async chat(prompt,emit,options){
    modelCalls++;assert.equal(prompt.includes('fixture-password'),false);assert.equal(options?.isolated,true);assert.ok(options?.outputSchema);
    scopeResponse=(await app.inject({method:'POST',url:'/api/liara/disconnect',headers})).statusCode;
    emit({type:'message',itemId:'result',text:output});emit({type:'done',status:'completed'});
  }};
  app=createApp(runtime,origin,liara);
  try{
    const token=(await app.inject({url:'/api/session',headers:{host}})).json().token;headers={host,origin,'x-liara-session':token};
    await liara.connect();liara.select('fixture-app');const snapshot=await liara.refresh();
    const call=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/diagnosis',headers,payload});
    assert.equal((await call({problem:'http500',evidenceId:snapshot.id})).statusCode,400);assert.equal(modelCalls,0);
    output=JSON.stringify({summary:'بررسی اولیه Authorization: Bearer fixture-token-not-real',likelyCauses:[{cause:'خطای برنامه',confidence:'low',evidenceIds:['logs']}],recommendedActions:['بررسی دستی'],missingInformation:['کد برنامه']});
    const result=await call({problem:'http500',evidenceId:snapshot.id,consent:true});
    assert.match(result.body,/ai_hypothesis/);assert.match(result.body,/"status":"completed"/);assert.equal(result.body.includes('fixture-token-not-real'),false);assert.equal(scopeResponse,409);
    output='invalid JSON';const invalid=await call({problem:'http500',evidenceId:snapshot.id,consent:true});assert.match(invalid.body,/"status":"failed"/);assert.doesNotMatch(invalid.body,/"type":"result"/);
    clock+=300001;assert.equal((await call({problem:'http500',evidenceId:snapshot.id,consent:true})).statusCode,409);assert.equal(modelCalls,2);
  }finally{await app.close();}
});
