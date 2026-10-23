import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {Store} from '../server/store.js';
import {LiaraNetworks,NetworkOperations,TEST_NETWORK_NAME} from '../server/networks.js';
import type {Runtime} from '../server/codex.js';
test('MOCK NETWORK HTTP: only exact authenticated human decision can dispatch one network creation',async()=>{
 let posts=0;const adapter=new LiaraNetworks({token:'FIXTURE-CREDENTIAL',fetch:async(url,init)=>{
  const path=new URL(String(url)).pathname;if(path==='/v1/me')return Response.json({user:{_id:'owner-1'}});
  if(init?.method==='POST'){posts++;return Response.json({});}
  return Response.json({networks:posts?[{_id:'network-1',name:TEST_NETWORK_NAME}]:[]});
 }});const store=new Store(':memory:'),networks=new NetworkOperations(store,adapter),origin='http://127.0.0.1:4310',host='127.0.0.1:4310';
 const runtime:Runtime={status:{state:'disconnected',message:'FIXTURE',verifiedConversation:false},async connect(){return this.status;},async chat(){},close(){}};
 const app=createApp(runtime,origin,undefined,undefined,{networks});try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({method:'POST',url:'/api/networks/proposal',headers:{host,origin},payload:{name:TEST_NETWORK_NAME,costUnknownAccepted:true}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/networks/proposal',headers,payload:{name:'different',costUnknownAccepted:true}})).statusCode,400);
  const proposed=await app.inject({method:'POST',url:'/api/networks/proposal',headers,payload:{name:TEST_NETWORK_NAME,costUnknownAccepted:true}});assert.equal(proposed.statusCode,200);const view=proposed.json();assert.equal(posts,0);
  const body={decision:'approve',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true};
  assert.equal((await app.inject({method:'POST',url:`/api/networks/${view.id}/decision`,headers:{...headers,origin:'https://evil.invalid'},payload:body})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:`/api/networks/${view.id}/decision`,headers,payload:{...body,application:'unauthorized'}})).statusCode,400);
  const response=await app.inject({method:'POST',url:`/api/networks/${view.id}/decision`,headers,payload:body});assert.equal(response.statusCode,200);assert.equal(response.json().networkID,'network-1');assert.equal(posts,1);
  assert.equal((await app.inject({method:'POST',url:`/api/networks/${view.id}/decision`,headers,payload:body})).statusCode,409);
  const checked=await app.inject({method:'POST',url:`/api/networks/${view.id}/reconcile`,headers,payload:{}});assert.equal(checked.json().state,'confirmed');assert.equal(posts,1);
  assert.equal((await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'unauthorized'}})).statusCode,404);
 }finally{await app.close();store.close();}
});
