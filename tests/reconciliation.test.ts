import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiaraDeployment} from '../server/deployment.js';
const target={accountId:'owner',appId:'test-app',projectId:'project-1',currentRelease:'base-release'};
function reader(options:{state?:string;current?:string;member?:boolean;account?:string}={}){
 const methods:string[]=[];
 const adapter=new LiaraDeployment({token:'FIXTURE-PRIVATE-CREDENTIAL',fetch:async(input,init)=>{
  methods.push(init?.method??'GET');const path=new URL(String(input)).pathname;
  if(path==='/v1/me')return Response.json({user:{_id:options.account??'owner',storage:{secretKey:'never-expose'}}});
  if(path==='/v1/projects/test-app')return Response.json({project:{_id:'project-1',project_id:'test-app',type:'node',envs:[{key:'SECRET',value:'never-expose'}]}});
  if(path==='/v1/projects/test-app/releases')return Response.json({currentRelease:options.current??'release-1',releases:options.member===false?[]:[{_id:'release-1',sourceAvailable:true,createdAt:'2026-10-22T00:00:00Z'}]});
  if(path==='/v1/releases/release-1')return Response.json({release:{state:options.state??'READY',status:'FIXTURE',failReason:'password=never-expose'}});
  throw new Error('Unexpected fixture path');
 }});return {adapter,methods};
}
test('MOCK NETWORK: a durably known exact release is reconciled by GETs without repeating cloud effects',async()=>{
 const {adapter,methods}=reader();const result=await adapter.reconcile({target,lastStep:'release_submitted',sourceID:'source-1',releaseID:'release-1'});
 assert.equal(result.state,'confirmed');assert.equal(result.releaseID,'release-1');assert.equal(result.httpHealth,'not_configured');
 assert.ok(result.evidence.length>=3);assert.ok(methods.every(method=>method==='GET'));assert.equal(JSON.stringify(result).includes('never-expose'),false);
});
test('MOCK NETWORK: a lost POST receipt cannot be inferred from a newest or matching-time release',async()=>{
 for(const lastStep of ['upload_dispatched','release_dispatched']){
  const {adapter,methods}=reader();const result=await adapter.reconcile({target,lastStep,sourceID:lastStep==='release_dispatched'?'source-1':undefined});
  assert.equal(result.state,'manual');assert.equal(result.reason,'missing_receipt');assert.equal(result.releaseID,undefined);assert.ok(methods.every(method=>method==='GET'));
 }
});
test('MOCK NETWORK: only terminal failure or exact current readiness resolves a known release',async()=>{
 for(const item of [{state:'FAILED',expected:'failed'},{state:'BUILDING',expected:'pending'},{state:'UNKNOWN_FUTURE_STATE',expected:'manual'}]){
  const {adapter}=reader({state:item.state});assert.equal((await adapter.reconcile({target,lastStep:'release_submitted',sourceID:'source-1',releaseID:'release-1'})).state,item.expected);
 }
 for(const options of [{member:false},{current:'other-release'},{account:'other-owner'}]){
  const {adapter}=reader(options);assert.equal((await adapter.reconcile({target,lastStep:'release_submitted',sourceID:'source-1',releaseID:'release-1'})).state,'manual');
 }
});
test('MOCK NETWORK: readiness must be followed by a fresh current-release read, never a stale earlier list',async()=>{
 let statusRead=false;
 const adapter=new LiaraDeployment({token:'FIXTURE-ONLY',fetch:async(url)=>{
  const path=new URL(String(url)).pathname;
  if(path==='/v1/me')return Response.json({user:{_id:'owner'}});
  if(path==='/v1/projects/test-app')return Response.json({project:{_id:'project-1',project_id:'test-app',type:'node'}});
  if(path==='/v1/releases/release-1'){statusRead=true;return Response.json({release:{state:'READY',status:'READY'}});}
  return Response.json({currentRelease:statusRead?'later-release':'release-1',releases:[{_id:'release-1'}]});
 }});
 assert.equal((await adapter.reconcile({target,lastStep:'release_submitted',sourceID:'source-1',releaseID:'release-1'})).reason,'release_not_current');
});
test('MOCK NETWORK: a release ID without its durable source receipt cannot resolve source identity',async()=>{
 const {adapter}=reader();const result=await adapter.reconcile({target,lastStep:'release_submitted',releaseID:'release-1'});assert.equal(result.state,'manual');assert.equal(result.reason,'missing_receipt');
});
