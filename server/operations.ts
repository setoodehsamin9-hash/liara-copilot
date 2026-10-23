import type {Store} from './store.js';
import {archiveDigest,deploymentOutcome,DeploymentError,type DeploymentOutcome,type Artifact,type DeployTarget,type RecoveryContext,type RecoveryProof} from './deployment.js';
import {safeDeploymentDiagnostic,type DeploymentDiagnostic} from './deployment-failure.js';
import type {RepairView} from './repair-types.js';
import {ApprovalGate,actionDigest,type CloudAction} from './authorization.js';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {hasCloudTargetConflict} from './cloud-targets.js';
import {allowedInitialTarget,initialDefinition,type InitialEvidence} from './initial-deployment-contract.js';
import type {DeployParameters} from './deployment.js';
import {ManualRecovery} from './manual-recovery.js';
type Input={target:DeployTarget;artifact:Artifact;parameters:DeployParameters;fixture:boolean;fixtureScenario?:string;check:()=>Promise<void>;execute:(step:(step:string,data?:string)=>void)=>Promise<unknown>}&({repair:RepairView;initial?:never}|{initial:InitialEvidence;repair?:never});
export type OperationView={id:string;digest:string;reviewNonce:string;expires:number;fixture:boolean;state:'pending'|'running'|'completed'|'rejected'|'uncertain'|'invalidated'|'expired'|'confirmed'|'failed';target:DeployTarget;revision:string;artifactDigest:string;archiveBytes:number;parameters:DeployParameters;impact:string;risks:string[];tests:{exitCode:number;finishedAt:string};purpose?:'initial-http500-baseline';initialRegression?:{exitCode:number;finishedAt:string};failure?:DeploymentDiagnostic;diff:string;lastStep?:string;outcome?:DeploymentOutcome;createdAt?:string;updatedAt?:string;recovery?:RecoveryProof};
export type OperationSummary={id:string;state:OperationView['state'];fixture:boolean|null;target:{accountId:string;appId:string};revision?:string;artifactDigest?:string;updatedAt?:string;lastStep?:string;sourceID?:string;releaseID?:string;recovery?:RecoveryProof;outcome?:DeploymentOutcome;metadataAvailable:boolean;canReconcile:boolean};
type Reconciliation=RecoveryContext&{fixture:boolean;scenario?:string};
type StoredRow={id:string;account:string;target:string;expires:number;state:OperationView['state'];lastStep:string|null;sourceID:string|null;releaseID:string|null;snapshot:string|null;createdAt:string|null;updatedAt:string|null;scenario:string|null;owner:string|null};
type RecordEntry={input:Input;action:CloudAction;principal:string;view:OperationView};
export class OperationError extends Error{readonly statusCode=409;readonly code='approval_denied';constructor(){super('پیشنهاد معتبر نیست، منقضی شده یا هدف درگیر عملیات دیگری است. نسخه، هدف و وضعیت عملیات را دوباره بررسی کنید.');}}
export class Operations{
 readonly support:ManualRecovery;
 private gate:ApprovalGate;private records=new Map<string,RecordEntry>();private checking=new Set<string>();private owner=randomUUID();
 constructor(private store:Store,private now=Date.now){
  this.gate=new ApprovalGate(store,now);
  store.db.exec(`CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,account TEXT NOT NULL,target TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,lastStep TEXT,sourceID TEXT,releaseID TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS operation_target_lock ON operations(account,target) WHERE state IN ('pending','running','uncertain');`);
  const columns=new Set((store.db.prepare('PRAGMA table_info(operations)').all() as {name:string}[]).map(column=>column.name));
  for(const column of ['snapshot','createdAt','updatedAt','scenario','owner','recoveryOwner'])if(!columns.has(column))store.db.exec(`ALTER TABLE operations ADD COLUMN ${column} TEXT`);
  // A new process never resumes a mutation or accepts a previous process's grant.
  store.db.prepare("UPDATE operations SET state=CASE WHEN state='pending' THEN 'invalidated' ELSE 'uncertain' END,updatedAt=? WHERE state IN ('pending','running')").run(this.timestamp());
  store.db.exec('UPDATE operations SET recoveryOwner=NULL');
  this.support=new ManualRecovery(store,now);
 }
 private timestamp(){return new Date(this.now()).toISOString();}
 private stored(id:string){const row=this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as StoredRow|undefined;if(!row)throw new OperationError();return row;}
 private owns(id:string){const row=this.stored(id);return row.state==='running'&&row.owner===this.owner;}
 private persist(view:OperationView,execution=false,recoveryOwner?:string){
  // Never persist source diff, nonce, commands, raw upstream errors or credentials.
  const {diff:_,reviewNonce:__,outcome:___,...metadata}=view;view.updatedAt=this.timestamp();
  const result=this.store.db.prepare('UPDATE operations SET state=?,snapshot=?,updatedAt=? WHERE id=?'+(execution?" AND state='running' AND owner=?":recoveryOwner?' AND recoveryOwner=?':'')).run(view.state,JSON.stringify({...metadata,outcome:deploymentOutcome(view.outcome),failure:safeDeploymentDiagnostic(view.failure),updatedAt:view.updatedAt}),view.updatedAt,view.id,...(execution?[this.owner]:recoveryOwner?[recoveryOwner]:[]));
  if(result.changes!==1)throw new OperationError();
 }
 private expire(){this.store.db.prepare("UPDATE operations SET state='expired',updatedAt=? WHERE state='pending' AND expires<=?").run(this.timestamp(),this.now());}
 prepare(input:Input,principal:string):OperationView{
  const initial=input.initial,tests=initial?.smoke??input.repair?.afterTests,regression=initial?.regression??input.repair?.regressionBefore,diff=initial?.diff??input.repair?.diff,revision=initial?.revision??input.repair?.revision;
  if(this.records.size>=100||(!initial&&input.repair?.state!=='review')||tests?.exitCode!==0||!tests.testSummary?.complete||tests.testSummary.total<1||tests.testSummary.passed!==tests.testSummary.total||tests.testSummary.failed!==0||regression?.exitCode!==1||!regression.testSummary?.complete||regression.testSummary.failed<1||!diff||input.artifact.revision!==revision||archiveDigest(input.artifact.bytes)!==input.artifact.digest)throw new OperationError();
  if(initial&&(initial.kind!=='intentional-http500-baseline-v1'||input.fixture||!allowedInitialTarget(input.target)||input.parameters.port!==3000||input.parameters.type!=='node'||input.parameters.platformConfig?.version!=='22'||JSON.stringify(initial.http)!==JSON.stringify(initialDefinition.expectedHTTP)))throw new OperationError();
  const impact=initial?'استقرار اولیهٔ نسخهٔ عمداً خراب آزمایشی؛ / و /health پاسخ 200، /api/checkout پاسخ 500؛ آزمون رگرسیون عمداً شکست دارد. برنامه به شبکهٔ مشترک متصل است؛ هزینهٔ ساخت، مالیات و هزینهٔ نهایی نامعلوم است.':input.fixture?'فقط اجرای سناریوی آزمایشی محلی؛ هیچ درخواست واقعی به لیارا ارسال نمی‌شود.':'ارسال سورس، ساخت و جایگزینی انتشار برنامهٔ واقعی؛ احتمال اختلال یا هزینهٔ ساخت وجود دارد.';
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const action:CloudAction={kind:'deploy',accountId:input.target.accountId,targetId:input.target.appId,revision:input.artifact.digest,parameters:{sourceRevision:input.artifact.revision,projectId:input.target.projectId,expectedCurrentRelease:input.target.currentRelease,...input.parameters,archiveBytes:input.artifact.bytes.length,impact,fixture:input.fixture,fixtureScenario:input.fixtureScenario??null,testDigest:hash(JSON.stringify(tests)),diffDigest:hash(diff),...(initial?{purpose:'initial-http500-baseline',definition:{...initialDefinition,scope:{...initialDefinition.scope},expectedHTTP:initialDefinition.expectedHTTP.map(row=>({...row}))},regressionDigest:hash(JSON.stringify(regression))}:{})}};
  let grant:ReturnType<ApprovalGate['prepare']>;
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   this.store.db.prepare("UPDATE operations SET state='expired' WHERE state='pending' AND expires<=?").run(this.now());
   if(hasCloudTargetConflict(this.store,action.accountId,action.targetId,undefined,this.now()))throw new OperationError();
   grant=this.gate.prepare(action,principal);
   this.store.db.prepare('INSERT INTO operations(id,account,target,expires,state,scenario) VALUES (?,?,?,?,?,?)').run(grant.id,action.accountId,action.targetId,grant.expires,'pending',input.fixtureScenario??null);
   this.store.db.exec('COMMIT');
  }catch{this.store.db.exec('ROLLBACK');throw new OperationError();}
  const view:OperationView={...grant,reviewNonce:randomBytes(32).toString('hex'),fixture:input.fixture,state:'pending',target:structuredClone(input.target),revision:input.artifact.revision,artifactDigest:input.artifact.digest,archiveBytes:input.artifact.bytes.length,parameters:structuredClone(input.parameters),impact,risks:['موفقیت آزمون محلی سلامت محیط واقعی را تضمین نمی‌کند.','درخواست ناموفق یا مبهم خودکار تکرار نمی‌شود؛ وضعیت باید بررسی شود.'],tests:{exitCode:tests.exitCode,finishedAt:tests.finishedAt},diff,...(initial?{purpose:'initial-http500-baseline' as const,initialRegression:{exitCode:regression.exitCode,finishedAt:regression.finishedAt}}:{})};
  view.createdAt=this.timestamp();this.persist(view);this.store.db.prepare('UPDATE operations SET createdAt=? WHERE id=?').run(view.createdAt,view.id);
  this.records.set(grant.id,{input,action,principal,view});return structuredClone(view);
 }
 get(id:string,principal:string):OperationView{
  this.expire();const row=this.stored(id),record=this.records.get(id);
  if(record){if(record.principal!==principal)throw new OperationError();return structuredClone({...record.view,state:row.state,updatedAt:row.updatedAt??undefined});}
  if(!row.snapshot||row.snapshot.length>65536)throw new OperationError();
  try{const metadata=JSON.parse(row.snapshot) as Omit<OperationView,'reviewNonce'|'diff'>;if(metadata.id!==id||metadata.target.accountId!==row.account||metadata.target.appId!==row.target)throw new Error();return {...metadata,failure:safeDeploymentDiagnostic(metadata.failure),state:row.state,lastStep:row.lastStep??undefined,reviewNonce:'',diff:'',updatedAt:row.updatedAt??undefined};}catch{throw new OperationError();}
 }
 list():OperationSummary[]{
  this.expire();return (this.store.db.prepare("SELECT * FROM operations ORDER BY CASE WHEN state IN ('uncertain','running','pending') THEN 0 ELSE 1 END,rowid DESC LIMIT 50").all() as StoredRow[]).map(row=>{
   let metadata:OperationView|undefined;try{if(row.snapshot)metadata=JSON.parse(row.snapshot) as OperationView;}catch{/* Legacy/corrupt metadata stays manual. */}
   const metadataAvailable=metadata?.id===row.id&&metadata?.target?.accountId===row.account&&metadata?.target?.appId===row.target;
   return {id:row.id,state:row.state,fixture:metadataAvailable?metadata!.fixture:null,target:{accountId:row.account,appId:row.target},revision:metadataAvailable?metadata!.revision:undefined,artifactDigest:metadataAvailable?metadata!.artifactDigest:undefined,updatedAt:row.updatedAt??undefined,lastStep:row.lastStep??undefined,sourceID:row.sourceID??undefined,releaseID:row.releaseID??undefined,recovery:metadataAvailable?metadata!.recovery:undefined,outcome:metadataAvailable?deploymentOutcome(metadata!.outcome):undefined,metadataAvailable,canReconcile:metadataAvailable&&!this.checking.has(row.id)&&['uncertain','completed','confirmed','failed'].includes(row.state)};
  });
 }
 async reconcile(id:string,principal:string,read:(context:Reconciliation)=>Promise<RecoveryProof>):Promise<OperationView>{
  if(this.checking.has(id))throw new OperationError();const view=this.get(id,principal),row=this.stored(id);
  if(!['uncertain','completed','confirmed','failed'].includes(row.state))throw new OperationError();
  const recoveryOwner=randomUUID();const claim=this.store.db.prepare('UPDATE operations SET recoveryOwner=? WHERE id=? AND state=?').run(recoveryOwner,id,row.state);if(claim.changes!==1)throw new OperationError();
  this.checking.add(id);
  try{
   let proof:RecoveryProof;
   try{proof=await read({target:structuredClone(view.target),lastStep:row.lastStep??undefined,sourceID:row.sourceID??undefined,releaseID:row.releaseID??undefined,fixture:view.fixture,scenario:row.scenario??undefined});}
   catch{proof={state:'manual',reason:'unavailable',checkedAt:this.timestamp(),evidence:[]};}
   view.recovery=proof;
   if(proof.state==='confirmed'||proof.state==='failed')view.state=proof.state;
   // Pending/manual evidence never releases an ambiguous operation's target lock.
   this.persist(view,false,recoveryOwner);const current=this.records.get(id);if(current)current.view=view;
   return this.get(id,principal);
  }finally{this.checking.delete(id);}
 }
 private validate(id:string,digest:string,nonce:string,principal:string){
  this.expire();const record=this.records.get(id);if(!record||record.principal!==principal||record.view.state!=='pending'||this.stored(id).state!=='pending'||record.view.expires<=this.now()||digest!==record.view.digest||actionDigest(record.action)!==digest||!/^[a-f0-9]{64}$/.test(nonce)||!timingSafeEqual(Buffer.from(nonce),Buffer.from(record.view.reviewNonce)))throw new OperationError();return record;
 }
 reject(id:string,digest:string,nonce:string,principal:string){
  const record=this.validate(id,digest,nonce,principal);this.gate.reject(id,digest,principal);record.view.state='rejected';this.persist(record.view);return this.get(id,principal);
 }
 async approve(id:string,digest:string,nonce:string,principal:string):Promise<OperationView>{
  const record=this.validate(id,digest,nonce,principal);
  try{if(archiveDigest(record.input.artifact.bytes)!==record.view.artifactDigest)throw new Error('Artifact changed');await record.input.check();}
  catch{this.gate.reject(id,digest,principal);record.view.state='invalidated';this.persist(record.view);throw new OperationError();}
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   this.gate.confirm(id,digest,principal);this.gate.consume(id,record.action,principal);
   const update=this.store.db.prepare("UPDATE operations SET state='running',owner=? WHERE id=? AND state='pending'").run(this.owner,id);if(update.changes!==1)throw new Error('Operation denied');record.view.state='running';this.persist(record.view,true);this.store.db.exec('COMMIT');
  }catch{this.store.db.exec('ROLLBACK');throw new OperationError();}
  record.view.state='running';
  try{
   const outcome=await record.input.execute((step,data)=>{
    if(!['upload_dispatched','source_uploaded','release_dispatched','release_submitted'].includes(step))throw new Error('Invalid step');
    const update=this.store.db.prepare("UPDATE operations SET lastStep=?,sourceID=COALESCE(?,sourceID),releaseID=COALESCE(?,releaseID) WHERE id=? AND state='running' AND owner=?").run(step,step==='source_uploaded'?data??null:null,step==='release_submitted'?data??null:null,id,this.owner);
    if(update.changes!==1)throw new OperationError();record.view.lastStep=step;this.persist(record.view,true);
   });
   record.view.outcome=deploymentOutcome(outcome);record.view.state='completed';this.persist(record.view,true);
  }catch(error){
   // Preserve the target lock after ambiguous/partial outcomes, including process restart.
   if(this.owns(id)){record.view.failure=safeDeploymentDiagnostic(error instanceof DeploymentError?error.diagnostic:undefined);record.view.state='uncertain';try{this.persist(record.view,true);}catch{/* A replacement process fenced this executor. */}}
  }
  return this.get(id,principal);
 }
}
