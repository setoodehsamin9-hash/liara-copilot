import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {ApprovalGate,actionDigest,type CloudAction} from './authorization.js';
import {ReadOnlyLiaraClient,redactSecrets} from './liara.js';
import type {Store} from './store.js';
import {hasCloudTargetConflict} from './cloud-targets.js';
import {validatedScope,scopedUrl,accountKey,accountInScope,type AccountScope} from './liara-scope.js';
import {ApplicationCreationInput,NEW_TEST_APPLICATION_NAME,ORIGINAL_TEST_APPLICATION_ID,TestApplicationName,applicationCreationBody,TEST_APPLICATION_ACCOUNT,TEST_APPLICATION_NAME,TEST_APPLICATION_NETWORK,type ApplicationCreationView,type CreationCost,type CreationEvidence,type CreationProject,type CreationReason,type CreationState} from './application-creation-contract.js';

export class ApplicationCreationError extends Error{
 readonly statusCode=409;
 constructor(readonly code='application_creation_denied'){super('ساخت برنامه تأیید نشد؛ مجوز، حساب، شبکه و پلن را بررسی کنید. درخواست ساخت مبهم را تکرار نکنید.');}
}
type Inspection={accountId:string;cost:CreationCost;target:CreationProject|null;evidence:CreationEvidence[];checkedAt:string};
export class LiaraApplicationCreation{
 #token:string;#fetch:typeof fetch;#reader:ReadOnlyLiaraClient;
 readonly scope:AccountScope;
 get accountId(){return accountKey(TEST_APPLICATION_ACCOUNT,this.scope);}
 constructor(options:{token:string;fetch?:typeof fetch;scope?:AccountScope}){
  this.scope=validatedScope(options.scope);this.#token=options.token;this.#fetch=options.fetch??fetch;this.#reader=new ReadOnlyLiaraClient(options.token,{fetch:options.fetch,scope:this.scope});
 }
 async inspect(networkId=TEST_APPLICATION_NETWORK,name:TestApplicationName=TEST_APPLICATION_NAME):Promise<Inspection>{
  try{
   TestApplicationName.parse(name);if(name===NEW_TEST_APPLICATION_NAME&&(this.scope.kind!=='team'||networkId!=='000000000000000000000004'))throw new ApplicationCreationError('target_scope_changed');
   const catalog=await this.#reader.testOptions(text=>redactSecrets(text,[this.#token]));
   if(catalog.accountId!==this.accountId)throw new ApplicationCreationError('account_changed');
   if((this.scope.kind==='personal'&&networkId!==TEST_APPLICATION_NETWORK)||!catalog.networks.some(row=>row.id===networkId))throw new ApplicationCreationError('network_changed');
   const plan=catalog.plans.find(row=>row.id==='small-g2'&&row.baseBundle==='basic'&&row.region==='iran');
   if(!plan||plan.ramGB!==0.5||plan.cpuCores!==0.5||plan.diskGB!==5)throw new ApplicationCreationError('plan_unavailable');
   const evidence:CreationEvidence[]=[{endpoint:'/v1/me',fetchedAt:catalog.fetchedAt},{endpoint:'/v1/networks',fetchedAt:catalog.fetchedAt}];
   const projects=await this.#reader.apps();
   if(new Set(projects.map(row=>row.project_id)).size!==projects.length)throw new ApplicationCreationError('ambiguous_projects');
   evidence.push({endpoint:'/v1/projects',fetchedAt:new Date().toISOString()});
   const target=projects.some(row=>row.project_id===name)?await this.#reader.creationDetails(name):null;
   if(name===NEW_TEST_APPLICATION_NAME&&target&&(target._id===ORIGINAL_TEST_APPLICATION_ID||!/^[a-f0-9]{24}$/.test(target._id)))throw new ApplicationCreationError('target_identity_changed');
   if(target)evidence.push({endpoint:`/v1/projects/${name}`,fetchedAt:new Date().toISOString()});
   return {accountId:catalog.accountId,cost:{finalKnown:false,hourlyPriceRaw:plan.hourlyPriceRaw,monthlyHardwareFromCLI:plan.monthlyHardwareFromCLI,baseBundleDisplayPrice:plan.baseBundleDisplayPrice,ramGB:plan.ramGB,cpuCores:plan.cpuCores,diskGB:plan.diskGB},target,evidence,checkedAt:new Date().toISOString()};
  }catch(error){if(error instanceof ApplicationCreationError)throw error;throw new ApplicationCreationError('creation_read_unavailable');}
 }
 /** Internal fixed-target dispatch only; durable approval consumption MUST precede this call. */
 async createOnce(networkId=TEST_APPLICATION_NETWORK,name:TestApplicationName=TEST_APPLICATION_NAME){
  TestApplicationName.parse(name);if(name===NEW_TEST_APPLICATION_NAME&&(this.scope.kind!=='team'||networkId!=='000000000000000000000004'))throw new ApplicationCreationError();
  const response=await this.#fetch(scopedUrl('/v1/projects',this.scope),{method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:`Bearer ${this.#token}`,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(applicationCreationBody(networkId,name))});
  const status=response.status;await response.body?.cancel().catch(()=>{});return status;
 }
}

type Row={id:string;account:string;target:string;state:CreationState;reason:CreationReason;attempts:number;grantID:string;digest:string;expires:number;snapshot:string;applicationId:string|null;postStatus:number|null;verifiedAt:string|null;configurationVerified:number;evidence:string;owner:string|null;recoveryOwner:string|null};
type Grant={action:CloudAction;principal:string;nonce:string;grantID:string};
const impact='ساخت یک برنامهٔ آزمایشی پولی در ایران با ۰٫۵ گیگابایت RAM، نیم هسته CPU و ۵ گیگابایت دیسک؛ هزینهٔ نهایی و مالیات نامشخص است. هیچ سورس، استقرار، راه‌اندازی مجدد، تغییر اندازه یا حذف در این مجوز نیست.';
const creationImpact=(name:TestApplicationName)=>impact+(name===NEW_TEST_APPLICATION_NAME?' این برنامه عضو شبکهٔ مشترک hamkharid-net می‌شود و می‌تواند با سرویس‌های همان شبکه ارتباط داشته باشد. هدف و عملیات قبلی مستقل و قفل‌شده باقی می‌مانند.':'');
export class ApplicationCreations{
 private gate:ApprovalGate;private grants=new Map<string,Grant>();private owner=randomUUID();
 constructor(private store:Store,private adapter:LiaraApplicationCreation,private now=Date.now){
  this.gate=new ApprovalGate(store,now);
  store.db.exec(`CREATE TABLE IF NOT EXISTS application_creations(id TEXT PRIMARY KEY,account TEXT NOT NULL,target TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts IN (0,1)),grantID TEXT NOT NULL,digest TEXT NOT NULL,expires INTEGER NOT NULL,snapshot TEXT NOT NULL,applicationId TEXT,postStatus INTEGER,verifiedAt TEXT,configurationVerified INTEGER NOT NULL DEFAULT 0,evidence TEXT NOT NULL DEFAULT '[]',owner TEXT,recoveryOwner TEXT,UNIQUE(account,target));
   CREATE TABLE IF NOT EXISTS application_creation_owner(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL);`);
  store.db.exec('BEGIN IMMEDIATE');
  try{
   store.db.prepare('INSERT INTO application_creation_owner(slot,owner) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET owner=excluded.owner').run(this.owner);
   store.db.exec("UPDATE application_creations SET state=CASE WHEN state='pending' THEN 'invalidated' ELSE 'uncertain' END,reason='restart' WHERE state IN ('pending','dispatched'); UPDATE application_creations SET recoveryOwner=NULL;");
   store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
 }
 private owns(){if((this.store.db.prepare('SELECT owner FROM application_creation_owner WHERE slot=1').get() as {owner:string}).owner!==this.owner)throw new ApplicationCreationError('superseded_process');}
 private row(id:string){const row=this.store.db.prepare('SELECT * FROM application_creations WHERE id=?').get(id) as Row|undefined;if(!row||row.account!==this.adapter.accountId||!accountInScope(row.account,this.adapter.scope))throw new ApplicationCreationError();return row;}
 private action(cost:CreationCost,networkId=TEST_APPLICATION_NETWORK,name:TestApplicationName=TEST_APPLICATION_NAME):CloudAction{return {kind:'resource_create',accountId:this.adapter.accountId,targetId:name,revision:'application-definition-v1',parameters:{scope:this.adapter.scope,resource:'application',method:'POST',path:'/v1/projects',body:applicationCreationBody(networkId,name),region:'iran',cost,impact:creationImpact(name),maximumAttempts:1,deployment:false,networkCreation:false}};}
 private matches(project:CreationProject,networkId=TEST_APPLICATION_NETWORK,name:TestApplicationName=TEST_APPLICATION_NAME){return project.project_id===name&&project.type==='node'&&project.planID==='small-g2'&&project.bundlePlanID==='basic'&&project.network._id===networkId&&project.readOnlyRootFilesystem===true;}
 get(id:string,principal:string):ApplicationCreationView{
  this.row(id);
  this.store.db.prepare("UPDATE application_creations SET state='expired',reason='expired' WHERE id=? AND state='pending' AND expires<=?").run(id,this.now());
  const row=this.row(id),grant=this.grants.get(id);
  if(row.state==='pending'&&grant&&grant.principal!==principal)throw new ApplicationCreationError();
  const snapshot=JSON.parse(row.snapshot) as ApplicationCreationView;
  if(snapshot.id!==row.id||snapshot.accountId!==row.account||snapshot.action.body.name!==row.target||!TestApplicationName.safeParse(row.target).success)throw new ApplicationCreationError();
  return {...snapshot,state:row.state,reason:row.reason,attempts:row.attempts,grantID:row.grantID,digest:row.digest,expires:row.expires,reviewNonce:row.state==='pending'?grant?.nonce??'':'',applicationId:row.applicationId??undefined,postStatus:row.postStatus??undefined,verifiedAt:row.verifiedAt??undefined,configurationVerified:row.configurationVerified===1,evidence:JSON.parse(row.evidence) as CreationEvidence[]};
 }
 async prepare(input:unknown,principal:string):Promise<ApplicationCreationView>{
  const parsed=ApplicationCreationInput.safeParse(input);if(!parsed.success)throw new ApplicationCreationError();const networkId=parsed.data.networkId,name=parsed.data.name;this.owns();
  let current=this.store.db.prepare('SELECT * FROM application_creations WHERE account=? AND target=?').get(this.adapter.accountId,name) as Row|undefined;
  if(current&&(current.attempts===1||current.applicationId))return this.reconcile(current.id,principal);
  const inspection=await this.adapter.inspect(networkId,name);this.owns();
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   this.owns();current=this.store.db.prepare('SELECT * FROM application_creations WHERE account=? AND target=?').get(this.adapter.accountId,name) as Row|undefined;
   if(current?.attempts||current?.applicationId)throw new ApplicationCreationError();
   if(hasCloudTargetConflict(this.store,this.adapter.accountId,name,current?.id,this.now()))throw new ApplicationCreationError('target_busy');
   if(current?.state==='pending'&&current.expires>this.now()&&this.grants.get(current.id)?.principal===principal){this.store.db.exec('COMMIT');return this.get(current.id,principal);}
   const id=current?.id??randomUUID(),action=this.action(inspection.cost,networkId,name),digest=actionDigest(action),existing=inspection.target;
   const grant=existing?{id:'',expires:0}:this.gate.prepare(action,principal);
   const view:ApplicationCreationView={id,accountId:this.adapter.accountId,state:existing?'existing':'pending',reason:existing?'already_exists':'awaiting_approval',attempts:0,grantID:grant.id,digest,expires:grant.expires,reviewNonce:'',configurationVerified:!!existing&&this.matches(existing,networkId,name),cost:inspection.cost,region:'iran',impact:creationImpact(name),action:{method:'POST',path:'/v1/projects',body:applicationCreationBody(networkId,name)},evidence:inspection.evidence};
   this.store.db.prepare("INSERT INTO application_creations(id,account,target,state,reason,grantID,digest,expires,snapshot,applicationId,verifiedAt,configurationVerified,evidence,owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,target) DO UPDATE SET state=excluded.state,reason=excluded.reason,grantID=excluded.grantID,digest=excluded.digest,expires=excluded.expires,snapshot=excluded.snapshot,applicationId=excluded.applicationId,verifiedAt=excluded.verifiedAt,configurationVerified=excluded.configurationVerified,evidence=excluded.evidence,owner=excluded.owner WHERE application_creations.attempts=0 AND application_creations.applicationId IS NULL").run(id,this.adapter.accountId,name,view.state,view.reason,grant.id,digest,grant.expires,JSON.stringify(view),existing?._id??null,inspection.checkedAt,view.configurationVerified?1:0,JSON.stringify(inspection.evidence),this.owner);
   this.store.db.exec('COMMIT');if(!existing)this.grants.set(id,{action,principal,grantID:grant.id,nonce:randomBytes(32).toString('hex')});return this.get(id,principal);
  }catch{this.store.db.exec('ROLLBACK');throw new ApplicationCreationError();}
 }
 private validate(id:string,digest:string,nonce:string,principal:string){
  this.owns();const view=this.get(id,principal),grant=this.grants.get(id);
  if(!grant||grant.principal!==principal||grant.grantID!==view.grantID||view.state!=='pending'||view.attempts!==0||view.digest!==digest||view.expires<=this.now()||actionDigest(grant.action)!==digest||!/^[a-f0-9]{64}$/.test(nonce)||!timingSafeEqual(Buffer.from(nonce),Buffer.from(grant.nonce)))throw new ApplicationCreationError();return grant;
 }
 reject(id:string,digest:string,nonce:string,principal:string){const grant=this.validate(id,digest,nonce,principal);this.gate.reject(grant.grantID,digest,principal);this.store.db.prepare("UPDATE application_creations SET state='rejected',reason='rejected' WHERE id=? AND state='pending' AND attempts=0").run(id);return this.get(id,principal);}
 async approve(id:string,digest:string,nonce:string,principal:string,acceptCostUncertainty:boolean):Promise<ApplicationCreationView>{
  if(acceptCostUncertainty!==true)throw new ApplicationCreationError();this.validate(id,digest,nonce,principal);const networkId=this.get(id,principal).action.body.network,name=TestApplicationName.parse(this.row(id).target);
  let inspection:Inspection;
  try{inspection=await this.adapter.inspect(networkId,name);}catch{this.invalidate(id,digest,nonce,principal);throw new ApplicationCreationError();}
  const grant=this.validate(id,digest,nonce,principal);
  if(actionDigest(this.action(inspection.cost,networkId,name))!==digest){this.invalidate(id,digest,nonce,principal);throw new ApplicationCreationError('precondition_changed');}
  if(inspection.target){this.gate.reject(grant.grantID,digest,principal);this.store.db.prepare("UPDATE application_creations SET state='existing',reason='already_exists',applicationId=?,verifiedAt=?,configurationVerified=?,evidence=? WHERE id=? AND state='pending' AND attempts=0").run(inspection.target._id,inspection.checkedAt,this.matches(inspection.target,networkId,name)?1:0,JSON.stringify(inspection.evidence),id);return this.get(id,principal);}
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   this.validate(id,digest,nonce,principal);if(hasCloudTargetConflict(this.store,this.adapter.accountId,name,id,this.now()))throw new ApplicationCreationError('target_busy');
   this.gate.confirm(grant.grantID,digest,principal);this.gate.consume(grant.grantID,grant.action,principal);
   const updated=this.store.db.prepare("UPDATE application_creations SET state='dispatched',attempts=1,owner=? WHERE id=? AND state='pending' AND attempts=0 AND grantID=?").run(this.owner,id,grant.grantID);if(updated.changes!==1)throw new ApplicationCreationError();this.store.db.exec('COMMIT');
  }catch{this.store.db.exec('ROLLBACK');throw new ApplicationCreationError();}
  let postStatus:number|undefined;try{postStatus=await this.adapter.createOnce(networkId,name);}catch{/* Never repeat an ambiguous mutation. */}
  try{this.owns();}catch{return this.get(id,principal);}
  const updated=this.store.db.prepare("UPDATE application_creations SET state='uncertain',reason='read_unavailable',postStatus=? WHERE id=? AND state='dispatched' AND owner=?").run(postStatus??null,id,this.owner);
  if(updated.changes!==1)return this.get(id,principal);return this.reconcile(id,principal);
 }
 private invalidate(id:string,digest:string,nonce:string,principal:string){const grant=this.validate(id,digest,nonce,principal);this.gate.reject(grant.grantID,digest,principal);this.store.db.prepare("UPDATE application_creations SET state='invalidated',reason='precondition_changed' WHERE id=? AND state='pending' AND attempts=0").run(id);}
 async reconcile(id:string,principal:string):Promise<ApplicationCreationView>{
  this.owns();const expected=this.row(id);if(!['dispatched','confirmed','existing','uncertain','failed'].includes(expected.state))throw new ApplicationCreationError();
  const networkId=this.get(id,principal).action.body.network,name=TestApplicationName.parse(expected.target);const recoveryOwner=randomUUID();this.store.db.prepare('UPDATE application_creations SET recoveryOwner=? WHERE id=?').run(recoveryOwner,id);
  try{
   const inspection=await this.adapter.inspect(networkId,name);this.owns();const current=this.row(id),project=inspection.target;
   const sameIdentity=!!project&&(!current.applicationId||current.applicationId===project._id),configured=!!project&&sameIdentity&&this.matches(project,networkId,name);
   let state:CreationState='uncertain',reason:CreationReason='not_found';
   if(project){
    if(!sameIdentity)reason='identity_changed';else if(!configured)reason='configuration_mismatch';
    else if(current.attempts===0){state='existing';reason='already_exists';}
    else if(current.postStatus===200){state='confirmed';reason='verified';}
    else reason='present_unattributed';
   }else if(current.postStatus&&[400,401,402,403,404,409,422].includes(current.postStatus)){state='failed';reason='request_rejected';}
   const updated=this.store.db.prepare('UPDATE application_creations SET state=?,reason=?,applicationId=COALESCE(applicationId,?),verifiedAt=?,configurationVerified=?,evidence=? WHERE id=? AND recoveryOwner=?').run(state,reason,project?._id??null,inspection.checkedAt,configured?1:0,JSON.stringify(inspection.evidence),id,recoveryOwner);
   if(updated.changes!==1)throw new ApplicationCreationError('stale_read');
  }catch{
   try{this.owns();this.store.db.prepare("UPDATE application_creations SET state='uncertain',reason='read_unavailable',configurationVerified=0 WHERE id=? AND recoveryOwner=?").run(id,recoveryOwner);}catch{/* Superseded readers cannot write. */}
  }
  return this.get(id,principal);
 }
}
