import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import type {Runtime} from '../server/codex.js';
import {ReadOnlyLiaraClient} from '../server/liara.js';
import {scopedUrl,verifyAccount,accountKey,AccountScope} from '../server/liara-scope.js';
import {scopeSelector} from '../server/scoped-services.js';
import {Store} from '../server/store.js';
import {LiaraObservability} from '../server/liara.js';
import {LiaraNetworks,NetworkOperations,TEST_NETWORK_NAME} from '../server/networks.js';
import {ApplicationCreations,LiaraApplicationCreation} from '../server/application-creations.js';
import type {Repairs} from '../server/repairs.js';
const teamId='000000000000000000000002',team={kind:'team',teamId} as const;
test('scope verifies team._id even with user.isTeam false; wrong/missing teams never downgrade to personal',async()=>{
 const raw={user:{_id:'owner',isTeam:false},team:{_id:teamId,teamName:'FIXTURE TEAM',balance:2000000}};
 assert.equal(verifyAccount(raw,team)._id,'owner:team:'+teamId);assert.equal(verifyAccount(raw,team).balance,2000000);
 assert.throws(()=>verifyAccount(raw));assert.throws(()=>verifyAccount({...raw,team:null},team));assert.throws(()=>AccountScope.parse({kind:'team',teamId:'../bad'}));
 assert.throws(()=>verifyAccount({...raw,team:{_id:'wrong'}},team));assert.notEqual(accountKey('owner'),accountKey('owner',team));
 assert.equal(scopedUrl('/v1/projects?count=10',team),'https://api.liara.ir/v1/projects?count=10&teamID='+teamId);assert.throws(()=>scopedUrl('/v1/me?teamID=forged',team));
 const calls:string[]=[];const client=new ReadOnlyLiaraClient('FIXTURE-CREDENTIAL',{scope:team,fetch:async input=>{calls.push(String(input));return Response.json(raw);}});
 assert.equal((await client.account())._id,'owner:team:'+teamId);assert.equal(calls.length,1);assert.equal(new URL(calls[0]!).searchParams.get('teamID'),teamId);
});

const owner='000000000000000000000001',personalNetwork='000000000000000000000005',teamNetwork='000000000000000000000004';
function fixture(){let bad=false,posts=0,networkCreated=false;const calls:{scope:string;path:string;method:string}[]=[];
 const fetcher:typeof fetch=async(raw,init)=>{const u=new URL(String(raw)),isTeam=u.searchParams.get('teamID')===teamId;calls.push({scope:isTeam?'team':'personal',path:u.pathname,method:init?.method??'GET'});
  if(u.pathname==='/v1/me')return Response.json({user:{_id:owner,isTeam:false},...(isTeam?{team:{_id:bad?'wrong-team':teamId,teamName:'FIXTURE TEAM',balance:2000000}}:{}),plans:{projects:{'small-g2':{available:true,region:'iran',RAM:{amount:0.5},CPU:{amount:0.5},volume:5,price:659.72}},projectBundlePlans:{'small-g2':{basic:{available:true,displayPrice:275000}}}}});
  if(init?.method==='POST'){posts++;assert.equal(isTeam,true);if(u.pathname==='/v1/networks'){networkCreated=true;throw new Error('MOCK LOST RESPONSE');}assert.equal(u.pathname,'/v1/projects');assert.equal(JSON.parse(String(init.body)).network,teamNetwork);return new Response(null,{status:402});}
  if(u.pathname==='/v1/networks')return Response.json({networks:isTeam?[{_id:teamNetwork,name:'hamkharid-net'},...(networkCreated?[{_id:'new-team-network',name:TEST_NETWORK_NAME}]:[])]:[{_id:personalNetwork,name:TEST_NETWORK_NAME}]});
  assert.equal(u.pathname,'/v1/projects');return Response.json({projects:[]});
 };return {fetcher,calls,posts:()=>posts,bad:()=>{bad=true;}};
}

test('MOCK SCOPE HTTP: verified switch isolates catalog/billing and old records; personal tombstone and consumed grant survive team operations',async()=>{
 const f=fixture(),store=new Store(':memory:'),liara=new LiaraObservability('FIXTURE-CREDENTIAL',{fetch:f.fetcher});await liara.connect();
 const networks=new NetworkOperations(store,new LiaraNetworks({token:'FIXTURE-CREDENTIAL',fetch:f.fetcher}));const personal=await networks.prepare(TEST_NETWORK_NAME,true,'human');
 const creations=new ApplicationCreations(store,new LiaraApplicationCreation({token:'FIXTURE-CREDENTIAL',fetch:f.fetcher}));
 store.db.prepare("INSERT INTO approvals(id,digest,principal,expires,state) VALUES('prior-consumed','prior-digest','prior-actor',0,'consumed')").run();
 const host='127.0.0.1:4310',origin='http://'+host,app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,liara,undefined,{networks,applicationCreations:creations,selectScope:scopeSelector('FIXTURE-CREDENTIAL',store,f.fetcher)});
 try{const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({method:'POST',url:'/api/liara/scope',headers:{host,origin},payload:team})).statusCode,401);
  const changed=await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:team});assert.equal(changed.statusCode,200);assert.equal(changed.json().account.id,owner+':team:'+teamId);
  const options=(await app.inject({method:'POST',url:'/api/liara/test-options',headers,payload:{}})).json();assert.equal(options.billing.balanceRaw,2000000);assert.deepEqual(options.networks,[{id:teamNetwork,name:'hamkharid-net'}]);
  assert.equal((await app.inject({url:'/api/networks/'+personal.id,headers})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/application-creations/proposal',headers,payload:{name:TEST_NETWORK_NAME,networkId:personalNetwork}})).statusCode,409);
  const proposed=await app.inject({method:'POST',url:'/api/application-creations/proposal',headers,payload:{name:TEST_NETWORK_NAME,networkId:teamNetwork}});assert.equal(proposed.statusCode,200);const view=proposed.json();assert.equal(view.accountId,owner+':team:'+teamId);assert.equal(view.action.body.network,teamNetwork);assert.equal(f.posts(),0);
  const decision={decision:'approve',digest:view.digest,reviewNonce:view.reviewNonce,acknowledge:true,acceptCostUncertainty:true};
  const executed=await app.inject({method:'POST',url:`/api/application-creations/${view.id}/decision`,headers,payload:decision});assert.equal(executed.statusCode,200);assert.equal(executed.json().state,'failed');assert.equal(executed.json().postStatus,402);assert.equal(executed.json().attempts,1);assert.equal(f.posts(),1);
  assert.equal((await app.inject({method:'POST',url:`/api/application-creations/${view.id}/decision`,headers,payload:decision})).statusCode,409);
  const personalSwitch=await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:{kind:'personal'}});assert.equal(personalSwitch.statusCode,200);
  assert.equal((await app.inject({url:'/api/application-creations/'+view.id,headers})).statusCode,409);assert.equal((store.db.prepare("SELECT state FROM approvals WHERE id='prior-consumed'").get() as {state:string}).state,'consumed');assert.equal((store.db.prepare('SELECT networkID FROM network_operations WHERE id=?').get(personal.id) as {networkID:string}).networkID,personalNetwork);assert.equal(f.posts(),1);
 }finally{await app.close();store.close();}
});

test('MOCK SCOPE: network lost response recovers only within team; cross-scope replay is denied and wrong-team authorization has no personal fallback',async()=>{
 const f=fixture(),store=new Store(':memory:'),select=scopeSelector('FIXTURE-CREDENTIAL',store,f.fetcher);try{
  const services=await select(team),view=await services.networks.prepare(TEST_NETWORK_NAME,true,'human');
  const result=await services.networks.approve(view.id,view.digest,view.reviewNonce,'human');assert.equal(result.state,'confirmed');assert.equal(result.accountId,owner+':team:'+teamId);assert.equal(result.attempts,1);assert.equal(f.posts(),1);
  await assert.rejects(services.networks.approve(view.id,view.digest,view.reviewNonce,'human'));const personalServices=await select({kind:'personal'});assert.throws(()=>personalServices.networks.get(view.id));assert.equal(f.posts(),1);
  f.bad();const before=f.calls.length;await assert.rejects(select(team));assert.ok(f.calls.slice(before).every(c=>c.scope==='team'));assert.equal(f.posts(),1);
 }finally{store.close();}
});

test('MOCK SCOPE: a network record cannot be read or changed by another owner in the same scope',async()=>{
 const store=new Store(':memory:');const adapter=(id:string)=>new LiaraNetworks({token:'FIXTURE-CREDENTIAL',fetch:async raw=>Response.json(new URL(String(raw)).pathname==='/v1/me'?{user:{_id:id}}:{networks:[{_id:'network',name:TEST_NETWORK_NAME}]})});
 try{const a=adapter('owner-A'),first=new NetworkOperations(store,a),record=await first.prepare(TEST_NETWORK_NAME,true,'human');const b=adapter('owner-B');await b.inspect();const second=new NetworkOperations(store,b);assert.throws(()=>second.get(record.id));await assert.rejects(second.reconcile(record.id));assert.equal((store.db.prepare('SELECT state FROM network_operations WHERE id=?').get(record.id) as {state:string}).state,'existing');}finally{store.close();}
});

test('MOCK SCOPE: fresh adapter verifies owner before recovering a persisted network, without preparing another creation',async()=>{
 const f=fixture(),store=new Store(':memory:');try{
  const old=new NetworkOperations(store,new LiaraNetworks({token:'FIXTURE-CREDENTIAL',fetch:f.fetcher})),view=await old.prepare(TEST_NETWORK_NAME,true,'human');
  const fresh=new NetworkOperations(store,new LiaraNetworks({token:'FIXTURE-CREDENTIAL',fetch:f.fetcher}));const result=await fresh.reconcile(view.id);assert.equal(result.state,'existing');assert.equal(result.networkID,personalNetwork);assert.equal(f.posts(),0);
 }finally{store.close();}
});

test('MOCK SCOPE HTTP: pending scope verification rejects scoped GETs and proposal preparation blocks switching',async()=>{
 for(const mode of ['switch','proposal']){
  const f=fixture(),store=new Store(':memory:'),liara=new LiaraObservability('FIXTURE-CREDENTIAL',{fetch:f.fetcher});await liara.connect();let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(r=>{entered=r;}),waiting=new Promise<void>(r=>{release=r;});const selector=scopeSelector('FIXTURE-CREDENTIAL',store,f.fetcher);
  const repairs={reviewedSource:async()=>{entered();await waiting;throw new Error('FIXTURE STOP AFTER GUARD');},close(){}} as unknown as Repairs;
  const host='127.0.0.1:4310',origin='http://'+host,app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,liara,undefined,{repairs,selectScope:async scope=>{if(mode==='switch'){entered();await waiting;}return selector(scope);}});
  try{const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token};
   const pending=mode==='switch'?app.inject({method:'POST',url:'/api/liara/scope',headers,payload:team}):app.inject({method:'POST',url:'/api/repairs/00000000-0000-4000-8000-000000000001/proposal',headers,payload:{reviewed:true,port:3000}});void pending.then(()=>{});await started;
   const blocked=mode==='switch'?await app.inject({url:'/api/liara/apps',headers}):await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:team});
   release();await pending;assert.equal(blocked.statusCode,409);
  }finally{release();await app.close();store.close();}
 }
});

test('scope selection is authenticated, strictly validated and unavailable without a verified scope controller',async()=>{
 const host='127.0.0.1:4310',origin='http://'+host,app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin);
 try{const token=(await app.inject({url:'/api/session',headers:{host}})).json().token;const headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:{kind:'team',teamId:'../invalid'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/liara/scope',headers,payload:{kind:'personal'}})).statusCode,409);
 }finally{await app.close();}
});
