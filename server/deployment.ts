import type {RepairFiles} from './repair-files.js';
import {c as tarCreate} from 'tar';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sourceDigest} from './repair-workspace.js';
import {AppId} from './liara.js';
import {validatedScope,verifyAccount,scopedUrl,accountInScope,type AccountScope} from './liara-scope.js';
import {initialTarget,initialDefinition,allowedInitialTarget} from './initial-deployment-contract.js';
import {TestApplicationName} from './application-creation-contract.js';
import type {DeploymentDiagnostic} from './deployment-failure.js';
const readTimeoutMs=6000,uploadTimeoutMs=120000;
export type DeployTarget={accountId:string;appId:string;projectId:string;currentRelease:string|null};
export type DeployParameters={port:number;type:string;platformConfig?:{version:string}};
export type Artifact={bytes:Uint8Array;digest:string;revision:string;manifest:string[]};
export type RecoveryContext={target:DeployTarget;lastStep?:string;sourceID?:string;releaseID?:string};
export type RecoveryProof={state:'confirmed'|'failed'|'pending'|'manual';reason:'ready'|'terminal_failure'|'in_progress'|'missing_receipt'|'not_dispatched'|'target_changed'|'release_not_current'|'unavailable'|'unknown_state'|'metadata_missing';checkedAt:string;releaseID?:string;releaseState?:string;currentRelease?:string|null;httpHealth?:'passed'|'failed'|'not_configured';evidence:{endpoint:string;fetchedAt:string}[]};
export function archiveDigest(bytes:Uint8Array){return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
export async function packageSource(files:RepairFiles):Promise<Artifact>{
 const before=await files.snapshot();const chunks:Buffer[]=[];let size=0;
 for await(const chunk of tarCreate({cwd:files.root,gzip:true,portable:true,noMtime:true,follow:false,strict:true},files.paths())){
  const buffer=Buffer.from(chunk);size+=buffer.length;if(size>2621440)throw new Error('Archive limit');chunks.push(buffer);
 }
 const after=await files.snapshot();if(sourceDigest(before)!==sourceDigest(after))throw new Error('Source changed while packaging');
 const bytes=Uint8Array.from(Buffer.concat(chunks));return {bytes,digest:archiveDigest(bytes),revision:sourceDigest(after),manifest:files.paths()};
}
const Id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Outcome=z.object({state:z.enum(['released','verified']),releaseID:Id,httpHealth:z.enum(['not_configured','passed']),fetchedAt:z.iso.datetime()});
export type DeploymentOutcome=z.infer<typeof Outcome>;
export function deploymentOutcome(value:unknown):DeploymentOutcome|undefined{const result=Outcome.safeParse(value);return result.success?result.data:undefined;}
export class DeploymentError extends Error{
 constructor(public readonly code:string,public readonly uncertain=false,public readonly diagnostic?:DeploymentDiagnostic){super('عملیات استقرار تأیید نشد؛ وضعیت واقعی را پیش از اقدام بعدی بررسی کنید.');}
}
export class LiaraDeployment{
 #token?:string;#fetch:typeof fetch;
 private settings:{pollDelayMs?:number;healthOrigin?:string;healthAppId?:string};
 readonly scope:AccountScope;
 constructor(options:{token?:string;fetch?:typeof fetch;pollDelayMs?:number;healthOrigin?:string;healthAppId?:string;scope?:AccountScope}){this.scope=validatedScope(options.scope);this.#token=options.token;this.#fetch=options.fetch??fetch;this.settings={pollDelayMs:options.pollDelayMs,healthOrigin:options.healthOrigin,healthAppId:options.healthAppId};if(options.healthOrigin){const url=new URL(options.healthOrigin);if(url.protocol!=='https:'||url.username||url.password||url.origin!==options.healthOrigin||!AppId.safeParse(options.healthAppId).success)throw new Error('Invalid health origin');}}
 private async call(path:string,method:'GET'|'POST',body?:FormData|Record<string,unknown>,receipt?:z.ZodType):Promise<unknown>{
  if(!this.#token)throw new DeploymentError('not_configured');
  const multipart=body instanceof FormData,phase=method==='GET'?'read':multipart?'upload':'release';
  const timeoutMs=phase==='upload'?uploadTimeoutMs:readTimeoutMs,started=Date.now();let status:number|undefined;
  const failure=(category:DeploymentDiagnostic['category'],code:string)=>new DeploymentError(code,method==='POST',{
   version:1,phase,category,...(status===undefined?{}:{status}),timeoutMs,elapsedMs:Math.min(3600000,Math.max(0,Date.now()-started)),
  });
  try{
   const response=await this.#fetch(scopedUrl(path,this.scope),{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${this.#token}`,Accept:'application/json',...(!multipart&&body?{'Content-Type':'application/json'}:{})},...(body?{body:multipart?body:JSON.stringify(body)}:{})});
   status=response.status;
   if(!response.ok){await response.body?.cancel().catch(()=>{});throw failure('http','upstream_rejected');}
   if(!response.body)throw failure('empty_response','invalid_response');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1048576){await reader.cancel();throw failure('response_limit','invalid_response');}chunks.push(value);}}finally{reader.releaseLock();}
   let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('invalid_json','invalid_response');}
   if(receipt){const result=receipt.safeParse(data);if(!result.success)throw failure('invalid_receipt','invalid_response');return result.data;}
   return data;
  }catch(error){if(error instanceof DeploymentError)throw error;throw failure(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'timeout':'network','upstream_failure');}
 }
 async inspect(appId:string):Promise<DeployTarget>{
  AppId.parse(appId);
  const account=verifyAccount(await this.call('/v1/me','GET'),this.scope);
  const project=z.object({project:z.object({_id:Id,project_id:AppId,type:z.literal('node')})}).parse(await this.call(`/v1/projects/${appId}`,'GET'));
  if(project.project.project_id!==appId)throw new DeploymentError('target_changed');
  const releases=z.object({currentRelease:Id.nullable()}).parse(await this.call(`/v1/projects/${appId}/releases?page=1&count=10`,'GET'));
  return {accountId:account._id,appId,projectId:project.project._id,currentRelease:releases.currentRelease};
 }
 private async check(target:DeployTarget){const fresh=await this.inspect(target.appId);if(JSON.stringify(fresh)!==JSON.stringify(target))throw new DeploymentError('target_changed');}
 async inspectInitial(name:TestApplicationName=initialTarget.appId):Promise<DeployTarget>{
  TestApplicationName.parse(name);
  if(this.scope.kind!=='team'||this.scope.teamId!==initialDefinition.scope.teamId)throw new DeploymentError('target_changed');
  const target=await this.inspect(name);
  if(!allowedInitialTarget(target))throw new DeploymentError('initial_target_changed');
  if(name!==initialTarget.appId){const list=z.object({projects:z.array(z.object({project_id:AppId}))}).parse(await this.call('/v1/projects','GET'));if(list.projects.filter(p=>p.project_id===name).length!==1)throw new DeploymentError('initial_target_changed');}
  const data=z.object({project:z.object({_id:z.literal(target.projectId),project_id:z.literal(name),type:z.literal('node'),planID:z.literal('small-g2'),bundlePlanID:z.literal('basic'),network:z.object({_id:z.literal(initialDefinition.networkId)}),readOnlyRootFilesystem:z.literal(true),isDeployed:z.literal(false)})}).safeParse(await this.call(`/v1/projects/${name}`,'GET'));
  if(!data.success)throw new DeploymentError('initial_configuration_changed');return target;
 }
 async reconcile(context:RecoveryContext):Promise<RecoveryProof>{
  const evidence:RecoveryProof['evidence']=[];
  const read=async(path:string)=>{const data=await this.call(path,'GET');evidence.push({endpoint:path,fetchedAt:new Date().toISOString()});return data;};
  const proof=(state:RecoveryProof['state'],reason:RecoveryProof['reason'],extra:Partial<RecoveryProof>={}):RecoveryProof=>({state,reason,checkedAt:new Date().toISOString(),evidence,...extra});
  try{
   const target=z.object({accountId:z.string().min(1).max(200),appId:AppId,projectId:Id,currentRelease:Id.nullable()}).strict().parse(context.target);
   const account=verifyAccount(await read('/v1/me'),this.scope);
   if(account._id!==target.accountId||!accountInScope(target.accountId,this.scope))return proof('manual','target_changed');
   const project=z.object({project:z.object({_id:Id,project_id:AppId,type:z.literal('node')})}).parse(await read(`/v1/projects/${target.appId}`));
   if(project.project._id!==target.projectId||project.project.project_id!==target.appId)return proof('manual','target_changed');
   const releases=z.object({currentRelease:Id.nullable(),releases:z.array(z.object({_id:Id})).max(1000)}).parse(await read(`/v1/projects/${target.appId}/releases?page=1&count=10`));
   const currentRelease=releases.currentRelease;
   if(!context.releaseID){
    if(context.lastStep==null||context.lastStep==='source_uploaded')return proof('failed','not_dispatched',{currentRelease});
    // Current/newest IDs and timestamps cannot establish exact source identity.
    return proof('manual','missing_receipt',{currentRelease});
   }
   const releaseID=Id.parse(context.releaseID);
   if(!Id.safeParse(context.sourceID).success||context.lastStep!=='release_submitted')return proof('manual','missing_receipt');
   if(releases.releases.filter(release=>release._id===releaseID).length!==1)return proof('manual','target_changed',{releaseID,currentRelease});
   const status=z.object({release:z.object({state:z.string().max(100),status:z.string().max(100)})}).parse(await read(`/v1/releases/${releaseID}`));
   const knownStates=['READY','FAILED','UNHEALTHY','CANCELED','TIMEDOUT','BUILDING','QUEUED','PENDING','DEPLOYING','CREATED','PUSHING','PUSHED'];
   const extra={releaseID,releaseState:knownStates.includes(status.release.state)?status.release.state:undefined,currentRelease};
   if(['FAILED','UNHEALTHY','CANCELED','TIMEDOUT'].includes(status.release.state))return proof('failed','terminal_failure',extra);
   if(status.release.state!=='READY')return proof(['BUILDING','QUEUED','PENDING','DEPLOYING','CREATED','PUSHING','PUSHED'].includes(status.release.state)?'pending':'manual', ['BUILDING','QUEUED','PENDING','DEPLOYING','CREATED','PUSHING','PUSHED'].includes(status.release.state)?'in_progress':'unknown_state',extra);
   const latest=z.object({currentRelease:Id.nullable()}).parse(await read(`/v1/projects/${target.appId}/releases?page=1&count=10`));extra.currentRelease=latest.currentRelease;
   if(latest.currentRelease!==releaseID)return proof('manual','release_not_current',extra);
   let httpHealth:RecoveryProof['httpHealth']='not_configured';
   if(this.settings.healthOrigin){
    if(this.settings.healthAppId!==target.appId)return proof('manual','target_changed',extra);
    try{const response=await this.#fetch(this.settings.healthOrigin+'/',{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000)});await response.body?.cancel().catch(()=>{});httpHealth=response.status===200?'passed':'failed';evidence.push({endpoint:this.settings.healthOrigin+'/',fetchedAt:new Date().toISOString()});}catch{httpHealth='failed';}
   }
   // The release is confirmed separately from HTTP health. Failed health never authorizes retry.
   return proof('confirmed','ready',{...extra,httpHealth});
  }catch{return proof('manual','unavailable');}
 }
 async deploy(target:DeployTarget,artifact:Artifact,params:DeployParameters,step:(step:string,data?:string)=>void):Promise<{state:'released'|'verified';releaseID:string;httpHealth:'not_configured'|'passed';fetchedAt:string}>{
  z.object({port:z.number().int().min(1).max(65535),type:z.literal('node'),platformConfig:z.object({version:z.literal('22')}).strict().optional()}).strict().parse(params);
  if(archiveDigest(artifact.bytes)!==artifact.digest)throw new DeploymentError('artifact_changed');
  if(this.settings.healthOrigin&&this.settings.healthAppId!==target.appId)throw new DeploymentError('health_target_mismatch');
  await this.check(target);
  const form=new FormData();form.append('file',new Blob([Uint8Array.from(artifact.bytes)],{type:'application/gzip'}),'source.tar.gz');
  step('upload_dispatched');
  const uploaded=await this.call(`/v2/projects/${target.appId}/sources`,'POST',form,z.object({sourceID:Id}));
  const source= z.object({sourceID:Id}).safeParse(uploaded);if(!source.success)throw new DeploymentError('invalid_upload_response',true);
  step('source_uploaded',source.data.sourceID);await this.check(target);step('release_dispatched');
  const submitted=await this.call(`/v2/projects/${target.appId}/releases`,'POST',{sourceID:source.data.sourceID,...params},z.object({releaseID:Id}));
  const release=z.object({releaseID:Id}).safeParse(submitted);if(!release.success)throw new DeploymentError('invalid_release_response',true);
  step('release_submitted',release.data.releaseID);
  for(let index=0;index<10;index++){
   const status=z.object({release:z.object({state:z.string().max(100),status:z.string().max(100)})}).parse(await this.call(`/v1/releases/${release.data.releaseID}`,'GET'));
   if(['FAILED','UNHEALTHY','CANCELED','TIMEDOUT'].includes(status.release.state))throw new DeploymentError('release_failed');
   if(status.release.state==='READY'){
    const current=z.object({currentRelease:Id.nullable()}).parse(await this.call(`/v1/projects/${target.appId}/releases?page=1&count=10`,'GET'));
    if(current.currentRelease!==release.data.releaseID)throw new DeploymentError('release_not_current');
    let httpHealth:'passed'|'not_configured'='not_configured';
    if(this.settings.healthOrigin){const response=await this.#fetch(this.settings.healthOrigin+'/',{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000)});await response.body?.cancel().catch(()=>{});if(response.status!==200)throw new DeploymentError('http_health_failed');httpHealth='passed';}
    return {state:httpHealth==='passed'?'verified':'released',releaseID:release.data.releaseID,httpHealth,fetchedAt:new Date().toISOString()};
   }
   await new Promise(done=>setTimeout(done,this.settings.pollDelayMs??1000));
  }
  throw new DeploymentError('verification_timeout');
 }
}
