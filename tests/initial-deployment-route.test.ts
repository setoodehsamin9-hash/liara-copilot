import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {LiaraObservability} from '../server/liara.js';
import {LiaraDeployment,archiveDigest} from '../server/deployment.js';
import {Store} from '../server/store.js';
import {Operations} from '../server/operations.js';
import type {Runtime} from '../server/codex.js';
const teamId='000000000000000000000002',scope={kind:'team',teamId} as const;
function transport(){let posts=0;const calls:string[]=[];const fetcher:typeof fetch=async(input,init)=>{
 const u=new URL(String(input));assert.equal(u.origin,'https://api.liara.ir');assert.equal(u.searchParams.get('teamID'),teamId);assert.equal(init?.redirect,'error');calls.push(u.pathname);
 if(init?.method!=='GET'){posts++;throw Error('No mutation authorized');}
 if(u.pathname==='/v1/me')return Response.json({user:{_id:'000000000000000000000001'},team:{_id:teamId}});
 if(u.pathname.endsWith('/releases'))return Response.json({currentRelease:null});
 if(u.pathname==='/v1/projects')return Response.json({projects:[{project_id:'liara-copilot-test-20261022',type:'node',isDeployed:false}]});
 return Response.json({project:{_id:'000000000000000000000003',project_id:'liara-copilot-test-20261022',type:'node',planID:'small-g2',bundlePlanID:'basic',network:{_id:'000000000000000000000004'},readOnlyRootFilesystem:true,isDeployed:false}});
 };return {fetcher,posts:()=>posts,calls};}
test('MOCK CLOUD / REAL LOCAL: authenticated initial proposal binds new grant without enabling or dispatching deployment',async()=>{
 const f=transport(),liara=new LiaraObservability('FIXTURE-CREDENTIAL',{scope,fetch:f.fetcher});await liara.connect();
 const store=new Store(':memory:'),operations=new Operations(store),origin='http://127.0.0.1:4310',host='127.0.0.1:4310';
 const app=createApp({status:{state:'disconnected'}} as unknown as Runtime,origin,liara,undefined,{operations,deployment:new LiaraDeployment({token:'FIXTURE-CREDENTIAL',scope,fetch:f.fetcher})});
 try{
  const token=(await app.inject({url:'/api/session',headers:{host}})).json().token,headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({method:'POST',url:'/api/initial-deployment/proposal',headers:{host,origin},payload:{reviewed:true}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/initial-deployment/proposal',headers,payload:{reviewed:true,path:'C:/other'}})).statusCode,400);
  const r=await app.inject({method:'POST',url:'/api/initial-deployment/proposal',headers,payload:{reviewed:true}});assert.equal(r.statusCode,200);const v=r.json();
  assert.equal(v.purpose,'initial-http500-baseline');assert.equal(v.initialRegression.exitCode,1);assert.equal(v.state,'pending');assert.equal(f.posts(),0);
  const denied=await app.inject({method:'POST',url:'/api/operations/'+v.id+'/decision',headers,payload:{decision:'approve',digest:v.digest,reviewNonce:v.reviewNonce,acknowledge:true}});
  assert.equal(denied.statusCode,409);assert.equal(f.posts(),0);assert.throws(()=>operations.get(v.id,'wrong'));
 }finally{await app.close();store.close();}
});
test('MOCK TEAM DEPLOYMENT: source/release and all receipts keep teamID; Node version uses official platformConfig.version',async()=>{
 const f=transport();let submitted=false,posts=0;
 const adapter=new LiaraDeployment({token:'FIXTURE-CREDENTIAL',scope,pollDelayMs:0,fetch:async(input,init)=>{
  const u=new URL(String(input));assert.equal(u.searchParams.get('teamID'),teamId);assert.equal(u.origin,'https://api.liara.ir');assert.equal(init?.redirect,'error');
  if(init?.method==='POST'){
   posts++;if(u.pathname.endsWith('/sources')){assert.ok(init.body instanceof FormData);return Response.json({sourceID:'fixture-source'});}
   assert.deepEqual(JSON.parse(String(init.body)),{sourceID:'fixture-source',port:3000,type:'node',platformConfig:{version:'22'}});submitted=true;return Response.json({releaseID:'fixture-release'});
  }
  if(u.pathname==='/v1/releases/fixture-release')return Response.json({release:{state:'READY',status:'READY'}});
  if(u.pathname.endsWith('/releases'))return Response.json({currentRelease:submitted?'fixture-release':null});
  return f.fetcher(input,init);
 }});
 const target=await adapter.inspectInitial(),bytes=new Uint8Array([1,2]);
 const result=await adapter.deploy(target,{bytes,digest:archiveDigest(bytes),revision:'fixture',manifest:[]},{port:3000,type:'node',platformConfig:{version:'22'}},()=>{});
 assert.equal(result.state,'released');assert.equal(posts,2);assert.equal(f.posts(),0);
});
