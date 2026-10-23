import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.js';
import {LiaraNetworks,NetworkOperations,TEST_NETWORK_NAME} from '../server/networks.js';
function fixture(options:{existing?:boolean;lostResponse?:boolean;unreadable?:boolean}={}){
 let exists=options.existing??false,posts=0,owner='owner-1',networkID='network-1';let unreadable=options.unreadable??false;
 const adapter=new LiaraNetworks({token:'FIXTURE-PRIVATE-CREDENTIAL',fetch:async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.liara.ir');assert.equal(init?.redirect,'error');
  if(url.pathname==='/v1/me')return Response.json({user:{_id:owner,storage:{secretKey:'DO_NOT_LEAK'}}});
  if(init?.method==='POST'){posts++;assert.equal(url.pathname,'/v1/networks');assert.deepEqual(JSON.parse(String(init.body)),{networkName:TEST_NETWORK_NAME});exists=true;if(options.lostResponse)throw new Error('DO_NOT_LEAK ambiguous transport');return new Response(null,{status:201});}
  assert.equal(url.pathname,'/v1/networks');if(unreadable&&posts)throw new Error('Read unavailable');return Response.json({networks:exists?[{_id:networkID,name:TEST_NETWORK_NAME,createdAt:'2026-10-22T00:00:00Z',secret:'DO_NOT_LEAK'}]:[]});
 }});
 return {adapter,posts:()=>posts,setOwner:(value:string)=>{owner=value;},allowReads:()=>{unreadable=false;},replaceNetwork:(id:string)=>{networkID=id;},removeNetwork:()=>{exists=false;}};
}
test('MOCK NETWORK: exact single-use approval is consumed durably before the only POST and authoritative read supplies the ID',async()=>{
 const f=fixture(),store=new Store(':memory:');const operations=new NetworkOperations(store,f.adapter);try{
  const proposal=await operations.prepare(TEST_NETWORK_NAME,true,'human');assert.equal(proposal.state,'pending');assert.equal(f.posts(),0);
  await assert.rejects(operations.approve(proposal.id,'0'.repeat(64),proposal.reviewNonce,'human'));
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'model'));assert.equal(f.posts(),0);
  const result=await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');assert.equal(result.state,'confirmed');assert.equal(result.networkID,'network-1');assert.equal(result.attempts,1);assert.equal(result.postStatus,201);
  assert.equal((store.db.prepare('SELECT state FROM approvals WHERE id=?').get(proposal.grantID) as {state:string}).state,'consumed');
  await assert.rejects(operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human'));assert.equal(f.posts(),1);assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'),false);assert.equal(JSON.stringify(f.adapter).includes('FIXTURE-PRIVATE-CREDENTIAL'),false);
 }finally{store.close();}
});
test('MOCK NETWORK: an existing exact network causes zero POSTs; alternate names and unaccepted unknown cost are rejected',async()=>{
 const f=fixture({existing:true}),store=new Store(':memory:');const operations=new NetworkOperations(store,f.adapter);try{
  await assert.rejects(operations.prepare('other-network',true,'human'));await assert.rejects(operations.prepare(TEST_NETWORK_NAME,false,'human'));
  const view=await operations.prepare(TEST_NETWORK_NAME,true,'human');assert.equal(view.state,'existing');assert.equal(view.networkID,'network-1');assert.equal(view.attempts,0);assert.equal(f.posts(),0);
 }finally{store.close();}
});
test('MOCK NETWORK: a lost POST response is reconciled by exact-name reads without another creation request',async()=>{
 const f=fixture({lostResponse:true}),store=new Store(':memory:');const operations=new NetworkOperations(store,f.adapter);try{
  const view=await operations.prepare(TEST_NETWORK_NAME,true,'human'),result=await operations.approve(view.id,view.digest,view.reviewNonce,'human');assert.equal(result.state,'confirmed');assert.equal(result.networkID,'network-1');assert.equal(result.postStatus,undefined);assert.equal(f.posts(),1);
 }finally{store.close();}
});
test('MOCK NETWORK: uncertainty and one-attempt tombstone survive restart; reconciliation never reuses approval',async()=>{
 const path=resolve('.local','network-operation-'+randomUUID()+'.sqlite'),f=fixture({lostResponse:true,unreadable:true});let store=new Store(path),operations=new NetworkOperations(store,f.adapter);
 const view=await operations.prepare(TEST_NETWORK_NAME,true,'human');assert.equal((await operations.approve(view.id,view.digest,view.reviewNonce,'human')).state,'uncertain');store.close();store=new Store(path);operations=new NetworkOperations(store,f.adapter);
 try{
  await assert.rejects(operations.approve(view.id,view.digest,view.reviewNonce,'human'));f.allowReads();
  const result=await operations.reconcile(view.id);assert.equal(result.state,'confirmed');assert.equal(result.networkID,'network-1');assert.equal(f.posts(),1);
  assert.equal((await operations.prepare(TEST_NETWORK_NAME,true,'new-human')).attempts,1);assert.equal(f.posts(),1);
 }finally{store.close();}
});
test('MOCK NETWORK: account drift and expiry prevent the dispatch and concurrent approvals cannot duplicate it',async()=>{
 for(const mode of ['account','expiry','concurrent']){const f=fixture(),store=new Store(':memory:');let now=Date.now();const operations=new NetworkOperations(store,f.adapter,()=>now);try{
  const view=await operations.prepare(TEST_NETWORK_NAME,true,'human');if(mode==='account')f.setOwner('another-owner');if(mode==='expiry')now=view.expires;
  if(mode==='concurrent'){const attempts=await Promise.allSettled([operations.approve(view.id,view.digest,view.reviewNonce,'human'),operations.approve(view.id,view.digest,view.reviewNonce,'human')]);assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.posts(),1);}
  else{await assert.rejects(operations.approve(view.id,view.digest,view.reviewNonce,'human'));assert.equal(f.posts(),0);}
 }finally{store.close();}}
});
test('MOCK NETWORK: a confirmed receipt never rebinds to a replacement sharing its name and fresh absence stays uncertain',async()=>{
 const f=fixture(),store=new Store(':memory:'),operations=new NetworkOperations(store,f.adapter);try{
  const proposal=await operations.prepare(TEST_NETWORK_NAME,true,'human');await operations.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human');
  f.replaceNetwork('replacement-network');const replaced=await operations.reconcile(proposal.id);assert.equal(replaced.state,'uncertain');assert.equal(replaced.networkID,'network-1');
  f.removeNetwork();const absent=await operations.prepare(TEST_NETWORK_NAME,true,'human');assert.equal(absent.state,'uncertain');assert.equal(absent.networkID,'network-1');assert.equal(f.posts(),1);
 }finally{store.close();}
});
