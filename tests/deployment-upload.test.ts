import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiaraDeployment,archiveDigest,DeploymentError} from '../server/deployment.js';
import {Operations} from '../server/operations.js';
import {Store} from '../server/store.js';
import type {RepairView} from '../server/repair-types.js';
import {safeDeploymentDiagnostic} from '../server/deployment-failure.js';
const teamId='000000000000000000000002',scope={kind:'team',teamId} as const,token='FIXTURE-SECRET-NOT-REAL';
const target={accountId:'owner:team:'+teamId,appId:'test-app',projectId:'project-id',currentRelease:null};
const bytes=new Uint8Array([31,139,8,0,0,12,255]),artifact={bytes,digest:archiveDigest(bytes),revision:'sha256:fixture',manifest:['app.mjs']};
function reads(url:URL){
 if(url.pathname==='/v1/me')return Response.json({user:{_id:'owner'},team:{_id:teamId}});
 if(url.pathname==='/v1/projects/test-app')return Response.json({project:{_id:'project-id',project_id:'test-app',type:'node'}});
 return Response.json({currentRelease:null,releases:[]});
}
test('MOCK upload: actual multipart wire has file/boundary/exact bytes; delayed receipt survives the normal read deadline',async t=>{
 const realTimeout=AbortSignal.timeout.bind(AbortSignal);const deadlines:number[]=[];
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{deadlines.push(ms);return realTimeout(Math.max(1,ms/100));});
 let uploads=0,releases=0;
 const adapter=new LiaraDeployment({token,scope,fetch:async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.liara.ir');assert.equal(url.searchParams.get('teamID'),teamId);assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);
  if(init?.method!=='POST')return reads(url);
  if(url.pathname.endsWith('/sources')){
   uploads++;assert.equal(new Headers(init.headers).has('content-type'),false);
   const wire=new Request(String(input),init);assert.match(wire.headers.get('content-type')!,/^multipart\/form-data; boundary=/);
   const form=await wire.formData();assert.equal(form.get('source'),null);const file=form.get('file') as File;assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
   await new Promise(done=>setTimeout(done,100));if(init.signal?.aborted)throw new DOMException(token,'TimeoutError');
   return Response.json({sourceID:'source-1'});
  }
  releases++;throw new Error('MOCK stop after verified upload receipt');
 }});
 const steps:string[]=[];await assert.rejects(adapter.deploy(target,artifact,{port:3000,type:'node'},(step,id)=>steps.push(step+':'+(id??''))));
 assert.equal(uploads,1);assert.equal(releases,1);assert.ok(steps.includes('source_uploaded:source-1'));assert.ok(deadlines.includes(120000));assert.ok(deadlines.includes(6000));
});
test('MOCK upload: HTTP/timeout/network/invalid receipt failures expose only safe typed diagnostics, never retry or create release',async()=>{
 for(const scenario of ['http','timeout','network','json','empty','oversize','receipt']){
  let uploads=0,releases=0;
  const adapter=new LiaraDeployment({token,scope,fetch:async(input,init)=>{
   const u=new URL(String(input));if(init?.method!=='POST')return reads(u);
   if(!u.pathname.endsWith('/sources')){releases++;throw Error('Unexpected release');}uploads++;
   if(scenario==='http')return new Response(token,{status:403,headers:{'x-secret':token}});
   if(scenario==='timeout')throw new DOMException(token,'TimeoutError');if(scenario==='network')throw Error(token);
   if(scenario==='json')return new Response(token);if(scenario==='empty')return new Response(null);if(scenario==='oversize')return new Response('x'.repeat(1048577));
   return Response.json({secret:token,source:'wrong-field'});
  }});
  let error:unknown;try{await adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{});}catch(e){error=e;}
  assert.ok(error instanceof DeploymentError);const diagnostic=(error as DeploymentError & {diagnostic?:{phase:string;category:string;status?:number}}).diagnostic;
  assert.equal(diagnostic?.phase,'upload');assert.equal(diagnostic?.category,{http:'http',timeout:'timeout',network:'network',json:'invalid_json',empty:'empty_response',oversize:'response_limit',receipt:'invalid_receipt'}[scenario]);
  if(scenario==='http')assert.equal(diagnostic?.status,403);
  assert.equal(JSON.stringify(error).includes(token),false);assert.equal(uploads,1);assert.equal(releases,0);
 }
});
test('MOCK persistence: sanitized failure survives restart without unlocking or accepting the consumed grant',async()=>{
 const store=new Store(':memory:');try{
  const operations=new Operations(store);const command={command:'FIXTURE',exitCode:0,stdout:'',stderr:'',startedAt:'2026-10-23T00:00:00Z',finishedAt:'2026-10-23T00:00:01Z',timedOut:false,testSummary:{complete:true,total:1,passed:1,failed:0}};
  const repair:RepairView={id:'fixture',label:'FIXTURE',fixture:true,state:'review',sourceRevision:'sha256:before',revision:artifact.revision,branch:'fixture',files:[],diff:'fixture diff',summary:'FIXTURE',beforeTests:{...command,exitCode:1},afterTests:command,regressionBefore:{...command,exitCode:1,testSummary:{complete:true,total:1,passed:0,failed:1}},events:[]};
  const adapter=new LiaraDeployment({token,scope,fetch:async(input,init)=>{if(init?.method==='POST')throw new DOMException(token,'TimeoutError');return reads(new URL(String(input)));}});
  const input={repair,target,artifact,parameters:{port:3000,type:'node'},fixture:true,check:async()=>{},execute:(step:(s:string,d?:string)=>void)=>adapter.deploy(target,artifact,{port:3000,type:'node'},step)};
  const view=operations.prepare(input,'human');const result=await operations.approve(view.id,view.digest,view.reviewNonce,'human');
  assert.equal(result.state,'uncertain');assert.equal((result as typeof result & {failure?:{category:string}}).failure?.category,'timeout');
  const row=store.db.prepare('SELECT snapshot FROM operations WHERE id=?').get(view.id) as {snapshot:string};assert.equal(row.snapshot.includes(token),false);
  const restarted=new Operations(store);assert.equal(restarted.get(view.id,'human').state,'uncertain');assert.throws(()=>restarted.prepare(input,'human'));
  await assert.rejects(restarted.approve(view.id,view.digest,view.reviewNonce,'human'));
 }finally{store.close();}
});
test('RECORDED observation: no exact source/release receipt stays manual even if synthetic newest release exists',async()=>{
 const recorded=JSON.parse(readFileSync('tests/fixtures/uncertain-upload-observation.json','utf8'));
 let posts=0;const adapter=new LiaraDeployment({token,scope,fetch:async(input,init)=>{if(init?.method!=='GET'){posts++;throw Error('Forbidden');}const u=new URL(String(input));if(u.pathname.endsWith('/releases'))return Response.json({currentRelease:'unrelated-newest',releases:[{_id:'unrelated-newest'}]});return reads(u);}});
 const result=await adapter.reconcile({target,lastStep:recorded.lastStep});assert.equal(result.state,'manual');assert.equal(result.reason,'missing_receipt');assert.equal(posts,0);assert.equal(recorded.failure,null);
});
test('diagnostic schema drops arbitrary bodies/headers and rejects free-text categories',()=>{
 const value={version:1,phase:'upload',category:'http',status:403,timeoutMs:120000,elapsedMs:12,body:token,headers:{Authorization:token},message:token};
 const safe=safeDeploymentDiagnostic(value);assert.ok(safe);assert.equal(JSON.stringify(safe).includes(token),false);
 assert.equal(safeDeploymentDiagnostic({...value,category:token}),undefined);
});
