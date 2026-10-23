import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRepairWorkspace} from '../server/repair-workspace.js';
import {packageSource,LiaraDeployment} from '../server/deployment.js';
import {t as listTar} from 'tar';
import {writeFile} from 'node:fs/promises';
const target={accountId:'owner',appId:'fixture-app',projectId:'project-id',currentRelease:'old-release'};
test('FIXTURE: source upload and release creation use exact contracts, then read back the exact release',async()=>{
 const workspace=await createRepairWorkspace(resolve('.local','package-test-'+randomUUID()),{'app.mjs':'export const hello = "world";'});
 const artifact=await packageSource(workspace.files);const calls:string[]=[];
 const archivePath=resolve(workspace.baseline,'artifact.tar.gz');await writeFile(archivePath,artifact.bytes);const entries:string[]=[];await listTar({file:archivePath,onReadEntry:entry=>{entries.push(entry.path);}});assert.deepEqual(entries,['app.mjs']);
 const adapter=new LiaraDeployment({token:'fixture-token-never-real',pollDelayMs:0,fetch:async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://api.liara.ir');assert.equal(init?.redirect,'error');calls.push(`${init?.method} ${url.pathname}`);
  if(url.pathname==='/v1/me')return Response.json({user:{_id:'owner'}});
  if(url.pathname==='/v1/projects/fixture-app')return Response.json({project:{_id:'project-id',project_id:'fixture-app',type:'node'}});
  if(url.pathname.endsWith('/sources')){assert.ok(init?.body instanceof FormData);const file=init.body.get('file') as File;assert.match(file.name,/\.tar\.gz$/);assert.deepEqual(new Uint8Array(await file.arrayBuffer()),artifact.bytes);return Response.json({sourceID:'source-1'});}
  if(init?.method==='POST'){assert.deepEqual(JSON.parse(String(init.body)),{sourceID:'source-1',port:3000,type:'node'});return Response.json({releaseID:'new-release'});}
  if(url.pathname==='/v1/releases/new-release')return Response.json({release:{state:'READY',status:'READY'}});
  return Response.json({currentRelease:calls.includes('POST /v2/projects/fixture-app/releases')?'new-release':'old-release',releases:[]});
 }});
 assert.equal(JSON.stringify(adapter).includes('fixture-token-never-real'),false);
 const result=await adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{});
 assert.equal(result.state,'released');assert.equal(result.releaseID,'new-release');assert.equal(result.httpHealth,'not_configured');
 assert.equal(calls.filter(call=>call.startsWith('POST')).length,2);
});
test('FIXTURE: unknown release state and failed release cannot be labeled verified',async()=>{
 for(const state of ['FAILED','NEW_UNKNOWN_STATE']){let statusReads=0,posts=0;
  const workspace=await createRepairWorkspace(resolve('.local','package-state-'+randomUUID()),{'app.mjs':'export const hello = "world";'});const artifact=await packageSource(workspace.files);
  const adapter=new LiaraDeployment({token:'fixture-only',pollDelayMs:0,fetch:async(input,init)=>{
   const path=new URL(String(input)).pathname;if(init?.method==='POST'){posts++;return Response.json(path.endsWith('/sources')?{sourceID:'source-1'}:{releaseID:'new-release'});}
   if(path==='/v1/me')return Response.json({user:{_id:'owner'}});if(path==='/v1/projects/fixture-app')return Response.json({project:{_id:'project-id',project_id:'fixture-app',type:'node'}});if(path==='/v1/releases/new-release'){statusReads++;return Response.json({release:{state,status:state}});}return Response.json({currentRelease:'old-release'});
  }});
  await assert.rejects(adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{}));assert.equal(posts,2);assert.equal(statusReads,state==='FAILED'?1:10);
 }
});
test('FIXTURE: an ambiguous source-upload failure is never retried or followed by release creation',async()=>{
 const workspace=await createRepairWorkspace(resolve('.local','package-fail-'+randomUUID()),{'app.mjs':'export const hello = "world";'});const artifact=await packageSource(workspace.files);let posts=0;
 const adapter=new LiaraDeployment({token:'fixture-only',fetch:async(input,init)=>{
  const path=new URL(String(input)).pathname;if(init?.method==='POST'){posts++;throw new Error('Connection lost after write');}
  if(path==='/v1/me')return Response.json({user:{_id:'owner'}});if(path==='/v1/projects/fixture-app')return Response.json({project:{_id:'project-id',project_id:'fixture-app',type:'node'}});return Response.json({currentRelease:'old-release'});
 }});
 await assert.rejects(adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{}));assert.equal(posts,1);
});
test('FIXTURE: bound HTTPS health checks carry no API credential and failure never becomes verified',async()=>{
 const workspace=await createRepairWorkspace(resolve('.local','package-health-'+randomUUID()),{'app.mjs':'export const hello = "world";'});const artifact=await packageSource(workspace.files);
 for(const healthStatus of [200,503]){
  let submitted=false,healthReads=0;
  const adapter=new LiaraDeployment({token:'fixture-private-token',healthOrigin:'https://fixture-health.invalid',healthAppId:target.appId,fetch:async(input,init)=>{
   const url=new URL(String(input));
   if(url.origin==='https://fixture-health.invalid'){healthReads++;assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('Authorization'),false);return new Response('fixture',{status:healthStatus});}
   if(init?.method==='POST'){if(url.pathname.endsWith('/sources'))return Response.json({sourceID:'source-1'});submitted=true;return Response.json({releaseID:'new-release'});}
   if(url.pathname==='/v1/me')return Response.json({user:{_id:'owner'}});
   if(url.pathname==='/v1/projects/fixture-app')return Response.json({project:{_id:'project-id',project_id:'fixture-app',type:'node'}});
   if(url.pathname==='/v1/releases/new-release')return Response.json({release:{state:'READY',status:'READY'}});
   return Response.json({currentRelease:submitted?'new-release':'old-release'});
  }});
  if(healthStatus===200){const result=await adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{});assert.equal(result.state,'verified');assert.equal(result.httpHealth,'passed');}
  else await assert.rejects(adapter.deploy(target,artifact,{port:3000,type:'node'},()=>{}),/استقرار/);
  assert.equal(healthReads,1);
 }
 let calls=0;
 const wrongApp=new LiaraDeployment({token:'fixture-only',healthOrigin:'https://fixture-health.invalid',healthAppId:'other-app',fetch:async()=>{calls++;throw new Error('Must not call');}});
 await assert.rejects(wrongApp.deploy(target,artifact,{port:3000,type:'node'},()=>{}));assert.equal(calls,0);
});
