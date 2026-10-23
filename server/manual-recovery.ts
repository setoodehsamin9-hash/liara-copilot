import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Store} from './store.js';

const Sha=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Hex=z.string().regex(/^[a-f0-9]{64}$/);
const Subject=z.object({operationId:z.string().uuid(),accountId:z.string().regex(/^[a-f0-9]{24}(?::team:[a-f0-9]{24})?$/),appId:z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),projectId:z.string().regex(/^[a-f0-9]{24}$/),artifactDigest:Sha,actionDigest:Hex}).strict();
const common={reviewNonce:Hex,subject:Subject,provider:z.literal('liara-support'),documentDigest:Sha,acknowledgeAuthority:z.literal(true)};
export const SupportEvidenceInput=z.discriminatedUnion('reportedOutcome',[
 z.object({...common,reportedOutcome:z.literal('source_exists'),sourceID:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)}).strict(),
 z.object({...common,reportedOutcome:z.literal('upload_absent')}).strict(),
 z.object({...common,reportedOutcome:z.literal('unknown')}).strict(),
]);
type Evidence={id:string;documentDigest:string;reportedOutcome:'source_exists'|'upload_absent'|'unknown';sourceID?:string;recordedAt:string;provenance:'operator_attested_liara_support'};
type Row={state:string;lastStep:string|null;account:string;target:string;sourceID:string|null;releaseID:string|null;snapshot:string|null;updatedAt:string|null};
type Challenge={principal:string;subject:z.infer<typeof Subject>;fingerprint:string;count:number;expires:number};
export class ManualRecoveryError extends Error{
 readonly statusCode=409;readonly code='support_evidence_denied';
 constructor(){super('شواهد یا بازبینی معتبر نیست. هدف و وضعیت نامطمئن را دوباره بررسی کنید؛ قفل حفظ می‌شود.');}
}

/** Local evidence intake only. No cloud transport, operation updates or approval authority. */
export class ManualRecovery{
 private challenges=new Map<string,Challenge>();
 constructor(private store:Store,private now=Date.now){
  store.db.exec(`CREATE TABLE IF NOT EXISTS support_evidence (
   sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,operationId TEXT NOT NULL,
   documentDigest TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(operationId,documentDigest));`);
 }
 invalidateReviews(){this.challenges.clear();}
 private context(id:string){
  if(!z.string().uuid().safeParse(id).success)throw new ManualRecoveryError();
  const row=this.store.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as Row|undefined;
  const grant=this.store.db.prepare('SELECT state FROM approvals WHERE id=?').get(id) as {state:string}|undefined;
  if(!row||row.state!=='uncertain'||row.lastStep!=='upload_dispatched'||row.sourceID||row.releaseID||!row.snapshot||row.snapshot.length>65536||grant?.state!=='consumed')throw new ManualRecoveryError();
  try{
   const metadata=JSON.parse(row.snapshot) as {id:string;digest:string;target:{accountId:string;appId:string;projectId:string};artifactDigest:string};
   const subject=Subject.parse({operationId:metadata.id,accountId:metadata.target.accountId,appId:metadata.target.appId,projectId:metadata.target.projectId,artifactDigest:metadata.artifactDigest,actionDigest:metadata.digest});
   if(subject.operationId!==id||subject.accountId!==row.account||subject.appId!==row.target)throw new Error();
   return {subject,fingerprint:createHash('sha256').update(JSON.stringify(row)).digest('hex')};
  }catch{throw new ManualRecoveryError();}
 }
 private evidence(id:string){return (this.store.db.prepare('SELECT body FROM support_evidence WHERE operationId=? ORDER BY sequence LIMIT 20').all(id) as {body:string}[]).map(row=>JSON.parse(row.body) as Evidence);}
 private projection(id:string){
  const evidence=this.evidence(id),exists=evidence.filter(e=>e.reportedOutcome==='source_exists'),absent=evidence.some(e=>e.reportedOutcome==='upload_absent');
  const conflict=(exists.length>0&&absent)||new Set(exists.map(e=>e.sourceID)).size>1;
  return {operationState:'uncertain' as const,lockRetained:true,cloudMutationAllowed:false,providerAuthenticityVerified:false,evidence,
   nextAction:conflict?'resolve_conflicting_evidence':exists.length?'verify_source_correlation':absent?'review_authoritative_absence':'request_support_evidence',
   message:'این ثبت فقط گواهی کاربر دربارهٔ پاسخ پشتیبانی است؛ تأیید مستقل لیارا یا مجوز اقدام ابری نیست. وضعیت اصلی و قفل حفظ می‌شود.'};
 }
 review(id:string,principal:string){
  for(const [nonce,c] of this.challenges)if(c.expires<=this.now())this.challenges.delete(nonce);
  if(this.challenges.size>=100)throw new ManualRecoveryError();
  const context=this.context(id),reviewNonce=randomBytes(32).toString('hex'),expires=this.now()+300_000,count=this.evidence(id).length;
  this.challenges.set(reviewNonce,{...context,principal,count,expires});
  return {...this.projection(id),subject:context.subject,reviewNonce,expires};
 }
 record(id:string,principal:string,input:unknown){
  const parsed=SupportEvidenceInput.safeParse(input);if(!parsed.success)throw new ManualRecoveryError();
  const body=parsed.data,challenge=this.challenges.get(body.reviewNonce);
  if(!challenge||challenge.principal!==principal||challenge.expires<=this.now()||JSON.stringify(challenge.subject)!==JSON.stringify(body.subject)||challenge.subject.operationId!==id)throw new ManualRecoveryError();
  this.store.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.context(id),count=this.evidence(id).length;
   if(current.fingerprint!==challenge.fingerprint||count!==challenge.count||count>=20)throw new ManualRecoveryError();
   const evidence:Evidence={id:randomUUID(),documentDigest:body.documentDigest,reportedOutcome:body.reportedOutcome,...(body.reportedOutcome==='source_exists'?{sourceID:body.sourceID}:{}),recordedAt:new Date(this.now()).toISOString(),provenance:'operator_attested_liara_support'};
   // Store only this allowlisted projection, never the support message, nonce or credentials.
   this.store.db.prepare('INSERT INTO support_evidence(id,operationId,documentDigest,body) VALUES (?,?,?,?)').run(evidence.id,id,body.documentDigest,JSON.stringify(evidence));
   this.store.db.exec('COMMIT');this.challenges.delete(body.reviewNonce);
  }catch{this.store.db.exec('ROLLBACK');throw new ManualRecoveryError();}
  return this.projection(id);
 }
}
