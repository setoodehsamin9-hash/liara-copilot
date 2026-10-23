import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import type {Runtime} from '../server/codex.js';
import {ApplicationCreations,LiaraApplicationCreation} from '../server/application-creations.js';
import {Store} from '../server/store.js';

test('application-creation routes require session and exact input, and fail closed when no executor is configured',async()=>{
 const origin='http://127.0.0.1:4310',host='127.0.0.1:4310';
 const runtime={status:{state:'disconnected'}} as unknown as Runtime;
 const app=createApp(runtime,origin);
 try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token;
  const headers={host,origin,'x-liara-session':token};
  const url='/api/application-creations/proposal';
  assert.equal((await app.inject({method:'POST',url,headers:{host,origin},payload:{}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{name:'different',networkId:'000000000000000000000005'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{name:'liara-copilot-test-20261022',networkId:'000000000000000000000005'}})).statusCode,409);
 }finally{await app.close();}
});

test('MOCK APP HTTP: proposal is read-only; exact separate cost-aware decision dispatches once and rejects origin, widening, replay and network-grant reuse',async()=>{
 const name='liara-copilot-test-20261022',network='000000000000000000000005',account='000000000000000000000001';let posts=0;
 const adapter=new LiaraApplicationCreation({token:'FIXTURE-PRIVATE-CREDENTIAL',fetch:async(raw,init)=>{
  const path=new URL(String(raw)).pathname;
  if(init?.method==='POST'){assert.equal(path,'/v1/projects');posts++;return new Response(null,{status:200});}
  if(path==='/v1/me')return Response.json({user:{_id:account},plans:{projects:{'small-g2':{available:true,region:'iran',RAM:{amount:0.5},CPU:{amount:0.5},volume:5,price:659.72}},projectBundlePlans:{'small-g2':{basic:{available:true,displayPrice:275000}}}}});
  if(path==='/v1/networks')return Response.json({networks:[{_id:network,name}]});
  const project={_id:'app-1',project_id:name,type:'node',planID:'small-g2',bundlePlanID:'basic',network:{_id:network,name},readOnlyRootFilesystem:true};
  return path==='/v1/projects'?Response.json({projects:posts?[project]:[]}):Response.json({project});
 }});
 const store=new Store(':memory:'),applicationCreations=new ApplicationCreations(store,adapter),origin='http://127.0.0.1:4310',host='127.0.0.1:4310';
 const app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,undefined,undefined,{applicationCreations});
 try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token};
  const proposed=await app.inject({method:'POST',url:'/api/application-creations/proposal',headers,payload:{name,networkId:network}});assert.equal(proposed.statusCode,200);assert.equal(posts,0);
  const view=proposed.json(),url=`/api/application-creations/${view.id}/decision`,body={decision:'approve',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true,acceptCostUncertainty:true};
  assert.equal((await app.inject({method:'POST',url,headers:{...headers,origin:'https://evil.invalid'},payload:body})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{...body,deploy:true}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{...body,acceptCostUncertainty:false}})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{...body,digest:'0'.repeat(64)}})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/application-creations/415a7c31-eddf-4026-83d7-a946c39af1a3/decision',headers,payload:body})).statusCode,409);
  assert.equal(posts,0);const result=await app.inject({method:'POST',url,headers,payload:body});assert.equal(result.statusCode,200);assert.equal(result.json().state,'confirmed');assert.equal(posts,1);
  assert.equal((await app.inject({method:'POST',url,headers,payload:body})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:`/api/application-creations/${view.id}/reconcile`,headers,payload:{}})).json().applicationId,'app-1');assert.equal(posts,1);
 }finally{await app.close();store.close();}
});
