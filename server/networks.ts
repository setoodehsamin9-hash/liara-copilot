import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {ApprovalGate,actionDigest,type CloudAction} from './authorization.js';
import type {Store} from './store.js';
import {validatedScope,verifyAccount,scopedUrl,accountInScope,type AccountScope} from './liara-scope.js';

// Deliberately limited to the separately reviewed Phase 5 test resource.
export const TEST_NETWORK_NAME='liara-copilot-test-20261022';
const Id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
type Evidence={endpoint:'/v1/me'|'/v1/networks';fetchedAt:string};
type Inspection={accountId:string;networks:{id:string;name:string}[];evidence:Evidence[];checkedAt:string};
export class NetworkError extends Error{
 readonly statusCode=409;
 constructor(readonly code='network_operation_denied'){super('عملیات شبکه تأیید نشد. حساب، مجوز و نتیجهٔ بررسی فقط‌خواندنی را بررسی کنید؛ درخواست ساخت را تکرار نکنید.');}
}
export class LiaraNetworks{
 #token?:string;#fetch:typeof fetch;
 private verifiedAccountId?:string;
 get accountId(){return this.verifiedAccountId;}
 readonly scope:AccountScope;
 constructor(options:{token?:string;fetch?:typeof fetch;scope?:AccountScope;verifiedAccountId?:string}){this.#token=options.token;this.#fetch=options.fetch??fetch;this.scope=validatedScope(options.scope);this.verifiedAccountId=options.verifiedAccountId;}
 private async request(path:'/v1/me'|'/v1/networks',method:'GET'|'POST'){
  if(!this.#token)throw new NetworkError('not_configured');
  return this.#fetch(scopedUrl(path,this.scope),{method,redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:`Bearer ${this.#token}`,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({networkName:TEST_NETWORK_NAME})}:{})});
 }
 private async read(path:'/v1/me'|'/v1/networks'):Promise<unknown>{
  try{
   const response=await this.request(path,'GET');if(!response.ok){await response.body?.cancel().catch(()=>{});throw new NetworkError('network_read_unavailable');}
   if(!response.body)throw new NetworkError('network_schema');const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw new NetworkError('network_response_limit');}chunks.push(value);}}finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }catch{throw new NetworkError('network_read_unavailable');}
 }
 async inspect():Promise<Inspection>{
  const account=verifyAccount(await this.read('/v1/me'),this.scope);
  if(this.verifiedAccountId&&this.verifiedAccountId!==account._id)throw new NetworkError('account_changed');this.verifiedAccountId=account._id;
  const evidence:Evidence[]=[{endpoint:'/v1/me',fetchedAt:new Date().toISOString()}];
  const networks=z.object({networks:z.array(z.object({_id:Id,name:z.string().min(1).max(200)})).max(200)}).parse(await this.read('/v1/networks')).networks;
  evidence.push({endpoint:'/v1/networks',fetchedAt:new Date().toISOString()});
  if(new Set(networks.map(row=>row._id)).size!==networks.length||new Set(networks.map(row=>row.name)).size!==networks.length)throw new NetworkError('ambiguous_networks');
  return {accountId:account._id,networks:networks.map(row=>({id:row._id,name:row.name})),checkedAt:new Date().toISOString(),evidence};
 }
 /** Internal executor only. Caller MUST consume the durable approval/attempt first. No retries. */
 async createOnce():Promise<number>{
  const response=await this.request('/v1/networks','POST');const status=response.status;
  // Official CLI consumes no response schema. Raw bodies never become evidence.
  await response.body?.cancel().catch(()=>{});return status;
 }
}
type State='pending'|'dispatched'|'confirmed'|'existing'|'uncertain'|'invalidated'|'rejected'|'expired';
type Row={id:string;account:string;name:string;state:State;attempts:number;grantID:string;digest:string;expires:number;networkID:string|null;postStatus:number|null;verifiedAt:string|null;evidence:string;owner:string|null};
export type NetworkView={id:string;accountId:string;name:string;state:State;attempts:number;grantID:string;digest:string;expires:number;reviewNonce:string;networkID?:string;postStatus?:number;verifiedAt?:string;evidence:Evidence[];cost:'unknown';impact:string;action:{method:'POST';path:'/v1/networks';body:{networkName:typeof TEST_NETWORK_NAME}}};
type Grant={action:CloudAction;principal:string;nonce:string;grantID:string};
export class NetworkOperations{
 private gate:ApprovalGate;private grants=new Map<string,Grant>();private owner=randomUUID();
 constructor(private store:Store,private adapter:LiaraNetworks,private now=Date.now){
  this.gate=new ApprovalGate(store,now);
  store.db.exec(`CREATE TABLE IF NOT EXISTS network_operations(id TEXT PRIMARY KEY,account TEXT NOT NULL,name TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts IN (0,1)),grantID TEXT NOT NULL,digest TEXT NOT NULL,expires INTEGER NOT NULL,networkID TEXT,postStatus INTEGER,verifiedAt TEXT,evidence TEXT NOT NULL DEFAULT '[]',owner TEXT,recoveryOwner TEXT,UNIQUE(account,name));`);
  store.db.exec("UPDATE network_operations SET state=CASE WHEN state='pending' THEN 'invalidated' ELSE 'uncertain' END WHERE state IN ('pending','dispatched'); UPDATE network_operations SET recoveryOwner=NULL;");
 }
 private row(id:string){const row=this.store.db.prepare('SELECT * FROM network_operations WHERE id=?').get(id) as Row|undefined;if(!row||row.account!==this.adapter.accountId||!accountInScope(row.account,this.adapter.scope))throw new NetworkError();return row;}
 async verifyScope(){if(!this.adapter.accountId)await this.adapter.inspect();}
 private action(accountId:string):CloudAction{return {kind:'resource_create',accountId,targetId:'network:'+TEST_NETWORK_NAME,revision:'network-definition-v1',parameters:{scope:this.adapter.scope,resource:'private_network',method:'POST',path:'/v1/networks',body:{networkName:TEST_NETWORK_NAME},cost:'unknown',costUnknownAccepted:true,maximumAttempts:1,applicationCreation:false,deployment:false}};}
 get(id:string):NetworkView{
  this.row(id);
  this.store.db.prepare("UPDATE network_operations SET state='expired' WHERE id=? AND state='pending' AND expires<=?").run(id,this.now());
  const row=this.row(id),grant=this.grants.get(id);
  return {id:row.id,accountId:row.account,name:row.name,state:row.state,attempts:row.attempts,grantID:row.grantID,digest:row.digest,expires:row.expires,reviewNonce:row.state==='pending'?grant?.nonce??'':'',networkID:row.networkID??undefined,postStatus:row.postStatus??undefined,verifiedAt:row.verifiedAt??undefined,evidence:JSON.parse(row.evidence) as Evidence[],cost:'unknown',impact:'ساخت حداکثر یک شبکهٔ خصوصی آزمایشی؛ هزینهٔ جداگانه نامشخص است. ساخت برنامه، استقرار و تغییر منابع دیگر شامل این پیشنهاد نیست.',action:{method:'POST',path:'/v1/networks',body:{networkName:TEST_NETWORK_NAME}}};
 }
 async prepare(name:string,costAccepted:boolean,principal:string):Promise<NetworkView>{
  if(name!==TEST_NETWORK_NAME||costAccepted!==true)throw new NetworkError();
  const inspection=await this.adapter.inspect();const existing=inspection.networks.find(row=>row.name===name);
  let row=this.store.db.prepare('SELECT * FROM network_operations WHERE account=? AND name=?').get(inspection.accountId,name) as Row|undefined;
  if(row&&(row.attempts===1||row.networkID))return this.reconcile(row.id); // Read-only recovery; a known receipt can never authorize another POST.
  let id=row?.id??randomUUID();const action=this.action(inspection.accountId),digest=actionDigest(action);
  if(existing){
   this.store.db.prepare("INSERT INTO network_operations(id,account,name,state,grantID,digest,expires,networkID,verifiedAt,evidence) VALUES (?,?,?,'existing','',?,0,?,?,?) ON CONFLICT(account,name) DO UPDATE SET state='existing',networkID=excluded.networkID,verifiedAt=excluded.verifiedAt,evidence=excluded.evidence WHERE network_operations.attempts=0").run(id,inspection.accountId,name,digest,existing.id,inspection.checkedAt,JSON.stringify(inspection.evidence));
   return this.get(id);
  }
  if(row?.state==='pending'&&row.expires>this.now()&&this.grants.get(id)?.principal===principal)return this.get(id);
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.store.db.prepare('SELECT * FROM network_operations WHERE account=? AND name=?').get(inspection.accountId,name) as Row|undefined;
   if(current?.attempts===1)throw new NetworkError();
   if(current)id=current.id;
   const approval=this.gate.prepare(action,principal);
   this.store.db.prepare("INSERT INTO network_operations(id,account,name,state,grantID,digest,expires,evidence) VALUES (?,?,?,'pending',?,?,?,?) ON CONFLICT(account,name) DO UPDATE SET state='pending',grantID=excluded.grantID,digest=excluded.digest,expires=excluded.expires,evidence=excluded.evidence WHERE network_operations.attempts=0").run(id,inspection.accountId,name,approval.id,digest,approval.expires,JSON.stringify(inspection.evidence));
   this.store.db.exec('COMMIT');this.grants.set(id,{action,principal,grantID:approval.id,nonce:randomBytes(32).toString('hex')});
  }catch{this.store.db.exec('ROLLBACK');throw new NetworkError();}
  return this.get(id);
 }
 private validate(id:string,digest:string,nonce:string,principal:string){
  const view=this.get(id),grant=this.grants.get(id);
  if(!grant||grant.principal!==principal||grant.grantID!==view.grantID||view.state!=='pending'||view.attempts!==0||view.expires<=this.now()||view.digest!==digest||actionDigest(grant.action)!==digest||!/^[a-f0-9]{64}$/.test(nonce)||!timingSafeEqual(Buffer.from(nonce),Buffer.from(grant.nonce)))throw new NetworkError();
  return grant;
 }
 reject(id:string,digest:string,nonce:string,principal:string){const grant=this.validate(id,digest,nonce,principal);this.gate.reject(grant.grantID,digest,principal);this.store.db.prepare("UPDATE network_operations SET state='rejected' WHERE id=? AND state='pending' AND attempts=0").run(id);return this.get(id);}
 async approve(id:string,digest:string,nonce:string,principal:string):Promise<NetworkView>{
  this.validate(id,digest,nonce,principal);const expected=this.row(id),inspection=await this.adapter.inspect();
  const grant=this.validate(id,digest,nonce,principal);if(inspection.accountId!==expected.account)throw new NetworkError('account_changed');
  const existing=inspection.networks.find(row=>row.name===expected.name);
  if(existing){this.gate.reject(grant.grantID,digest,principal);this.store.db.prepare("UPDATE network_operations SET state='existing',networkID=?,verifiedAt=?,evidence=? WHERE id=? AND attempts=0 AND state='pending'").run(existing.id,inspection.checkedAt,JSON.stringify(inspection.evidence),id);return this.get(id);}
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   this.gate.confirm(grant.grantID,digest,principal);this.gate.consume(grant.grantID,grant.action,principal);
   const update=this.store.db.prepare("UPDATE network_operations SET state='dispatched',attempts=1,owner=? WHERE id=? AND state='pending' AND attempts=0 AND grantID=?").run(this.owner,id,grant.grantID);if(update.changes!==1)throw new NetworkError();this.store.db.exec('COMMIT');
  }catch{this.store.db.exec('ROLLBACK');throw new NetworkError();}
  let postStatus:number|undefined;
  try{postStatus=await this.adapter.createOnce();}catch{/* Unknown remote outcome. Only reads follow. */}
  this.store.db.prepare("UPDATE network_operations SET state='uncertain',postStatus=? WHERE id=? AND state='dispatched' AND owner=?").run(postStatus??null,id,this.owner);
  return this.reconcile(id);
 }
 async reconcile(id:string):Promise<NetworkView>{
  await this.verifyScope();
  const expected=this.row(id);if(!['uncertain','dispatched','confirmed','existing'].includes(expected.state))throw new NetworkError();
  const recoveryOwner=randomUUID();this.store.db.prepare('UPDATE network_operations SET recoveryOwner=? WHERE id=?').run(recoveryOwner,id);
  try{
   const inspection=await this.adapter.inspect();if(inspection.accountId!==expected.account)throw new NetworkError('account_changed');
   const network=inspection.networks.find(row=>row.name===expected.name);
   // Keep the first authoritative receipt immutable, including across absence or name reuse.
   const current=this.row(id);
   const matches=network&&(!current.networkID||current.networkID===network.id);
   const state=matches?(current.attempts===0?'existing':'confirmed'):'uncertain';
   const update=this.store.db.prepare('UPDATE network_operations SET state=?,networkID=COALESCE(networkID,?),verifiedAt=?,evidence=? WHERE id=? AND recoveryOwner=?').run(state,network?.id??null,inspection.checkedAt,JSON.stringify(inspection.evidence),id,recoveryOwner);
   if(update.changes!==1)throw new NetworkError('stale_network_read');
  }catch{this.store.db.prepare("UPDATE network_operations SET state='uncertain' WHERE id=? AND recoveryOwner=?").run(id,recoveryOwner);}
  return this.get(id);
 }
}
