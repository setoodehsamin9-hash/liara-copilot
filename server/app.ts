import Fastify from 'fastify';
import { randomBytes, timingSafeEqual,createHash } from 'node:crypto';
import type { OutgoingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { assertReadOnlyCapability } from './authorization.js';
import type { Runtime } from './codex.js';
import { AppId, LiaraError, LiaraObservability } from './liara.js';
import { SourceRegistry, SourceError, GitHubOwner, GitHubRepo } from './sources.js';
import {captureSource} from './repair-files.js';
import { Problem, Finding, prepareDiagnosis, finishDiagnosis, type DiagnosisEvent } from './diagnosis.js';
import {Repairs} from './repairs.js';
import {Operations,OperationError} from './operations.js';
import {Store} from './store.js';
import {LiaraDeployment,packageSource} from './deployment.js';
import {fixtureDeployment,fixtureTarget,type FixtureScenario} from './deployment-fixture.js';
import {sourceDigest} from './repair-workspace.js';
import {packageRepairZip} from './repair-zip.js';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash as hashBytes} from 'node:crypto';
import type {AppScope} from './source-types.js';
import {NetworkError,TEST_NETWORK_NAME,type NetworkOperations} from './networks.js';
import {ApplicationCreationError,type ApplicationCreations} from './application-creations.js';
import {ApplicationCreationInput,TestApplicationName} from './application-creation-contract.js';
import {AccountScope,accountInScope} from './liara-scope.js';
import type {ScopedServices} from './scoped-services.js';
import {prepareInitialBaseline} from './initial-deployment.js';
import {initialTarget} from './initial-deployment-contract.js';
import {SupportEvidenceInput,ManualRecoveryError} from './manual-recovery.js';

export function createApp(runtime: Runtime, origin: string, liara = new LiaraObservability(), sources = new SourceRegistry(),services:{repairs?:Repairs;operations?:Operations;deployment?:LiaraDeployment;liveDeploymentEnabled?:boolean;networks?:NetworkOperations;applicationCreations?:ApplicationCreations;selectScope?:(scope:AccountScope)=>Promise<ScopedServices>}={}) {
  const app = Fastify({ bodyLimit: 16_384, logger: false, requestTimeout: 150_000 });
  const capability = randomBytes(32).toString('hex');
  const host = new URL(origin).host;
  let active = false;
  let switchingScope=false;
  let connecting = false;
  let sourceBusy = false;
  let sourceReading = false;
  const repairs=services.repairs??new Repairs({redact:text=>sources.sanitize(liara.redact(text))});
  const ownStore=services.operations?undefined:new Store(':memory:');
  const operations=services.operations??new Operations(ownStore!);
  const humanPrincipal=createHash('sha256').update(capability).digest('hex');
  const repairScopes=new Map<string,AppScope>();
  app.addHook('onClose',async()=>{repairs.close();ownStore?.close();});
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'" + (process.argv.includes('--dev') ? " 'unsafe-inline'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (req.headers.host !== host) return reply.code(403).send({ error: 'invalid_host' });
    if (req.headers.origin && req.headers.origin !== origin) return reply.code(403).send({ error: 'invalid_origin' });
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return reply.code(403).send({ error: 'cross_site_request' });
    if (!req.url.startsWith('/api/')) return;
    if (req.url === '/api/session' && req.method === 'GET') return;
    if (req.method !== 'GET' && req.headers.origin !== origin) return reply.code(403).send({ error: 'origin_required' });
    const token = req.headers['x-liara-session'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(capability))) return reply.code(401).send({ error: 'session_required' });
    if(switchingScope&&req.method==='GET'&&/^\/api\/(liara|sources|networks|application-creations|operations|repairs)(\/|$)/.test(req.url))return reply.code(409).send({error:'scope_switching'});
    if ((active || sourceBusy) && req.method !== 'GET' && (req.url.startsWith('/api/liara/') || req.url.startsWith('/api/sources/') || req.url.startsWith('/api/networks/') || req.url.startsWith('/api/application-creations/'))) return reply.code(409).send({error:'busy'});
  });
  function scope() {
    const status=liara.status();
    if(status.state!=='connected'||!status.account||!status.selectedApp)throw new SourceError('invalid_source',409);
    return {accountId:status.account.id,appId:status.selectedApp};
  }
  function requireScopeIdle(){if(active||sourceBusy||sourceReading||connecting)throw new SourceError('invalid_source',409);}
  function operationScope(view:{fixture:boolean|null;target:{accountId:string}}){if(!view.fixture&&(!accountInScope(view.target.accountId,liara.status().scope)||(services.selectScope&&view.target.accountId!==liara.status().account?.id)))throw new OperationError();return view;}
  app.post('/api/liara/scope',async(req,reply)=>{
    const selected=AccountScope.safeParse(req.body);if(!selected.success)return reply.code(400).send({error:'invalid_account_scope'});
    requireScopeIdle();if(!services.selectScope)return reply.code(409).send({error:'scope_unavailable'});operations.support.invalidateReviews();active=true;switchingScope=true;
    try{const next=await services.selectScope(selected.data);liara.disconnect();liara=next.liara;services.networks=next.networks;services.applicationCreations=next.applicationCreations;services.deployment=next.deployment;return liara.status();}finally{active=false;switchingScope=false;}
  });
  app.get('/api/session', async () => ({ token: capability }));
  app.get('/api/status', async () => ({ codex: runtime.status, phase: 5, liara: liara.status().state, capabilities: { chat: true, diagnostics: true, isolatedRepair: true, sourceWrite: false, cloudMutation: services.liveDeploymentEnabled===true } }));
  app.get('/api/repair/status',async()=>({fixtureAvailable:true,liveDeploymentEnabled:services.liveDeploymentEnabled===true,supportedTests:'Node .test.mjs; no dependencies, subprocess or network'}));
  app.post('/api/initial-deployment/proposal',async(req,reply)=>{
    const body=z.object({reviewed:z.literal(true),name:TestApplicationName.optional()}).strict().safeParse(req.body);if(!body.success)return reply.code(400).send({error:'review_required'});
    requireScopeIdle();active=true;
    try{
      const adapter=services.deployment,status=liara.status();
      if(!adapter||status.state!=='connected'||status.account?.id!==initialTarget.accountId||status.scope?.kind!=='team')return reply.code(409).send({error:'initial_scope_required'});
      const target=await adapter.inspectInitial(body.data.name),baseline=await prepareInitialBaseline();
      const parameters={port:3000,type:'node',platformConfig:{version:'22'}};
      const check=async()=>{
        if(!services.liveDeploymentEnabled||services.deployment!==adapter||liara.status().account?.id!==initialTarget.accountId)throw new Error('Deployment disabled or scope changed');
        await baseline.check();if(JSON.stringify(await adapter.inspectInitial(body.data.name))!==JSON.stringify(target))throw new Error('Target changed');
      };
      const view=operations.prepare({initial:baseline.evidence,target,artifact:baseline.artifact,parameters,fixture:false,check,execute:step=>adapter.deploy(target,baseline.artifact,parameters,step)},humanPrincipal);
      return {...view,baselinePath:baseline.baselinePath,archivePath:baseline.archivePath};
    }finally{active=false;}
  });
  function applicationCreations(){if(!services.applicationCreations)throw new ApplicationCreationError('application_creation_unavailable');return services.applicationCreations;}
  app.post('/api/application-creations/proposal',async(req,reply)=>{
    const body=ApplicationCreationInput.safeParse(req.body);if(!body.success)return reply.code(400).send({error:'invalid_application_proposal'});
    requireScopeIdle();active=true;try{return await applicationCreations().prepare(body.data,humanPrincipal);}finally{active=false;}
  });
  app.get('/api/application-creations/:id',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_application_operation'});return applicationCreations().get(id.data,humanPrincipal);
  });
  app.post('/api/application-creations/:id/decision',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=z.object({decision:z.enum(['approve','reject']),digest:z.string().regex(/^[a-f0-9]{64}$/),reviewNonce:z.string().regex(/^[a-f0-9]{64}$/),acknowledge:z.literal(true),acceptCostUncertainty:z.boolean()}).strict().safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'invalid_application_approval'});
    requireScopeIdle();active=true;try{return body.data.decision==='reject'?applicationCreations().reject(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal):await applicationCreations().approve(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal,body.data.acceptCostUncertainty);}finally{active=false;}
  });
  app.post('/api/application-creations/:id/reconcile',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success||!z.object({}).strict().safeParse(req.body).success)return reply.code(400).send({error:'invalid_application_reconciliation'});
    requireScopeIdle();active=true;try{return await applicationCreations().reconcile(id.data,humanPrincipal);}finally{active=false;}
  });
  function networkOperations(){if(!services.networks)throw new NetworkError('network_creation_unavailable');return services.networks;}
  app.post('/api/networks/proposal',async(req,reply)=>{
    const body=z.object({name:z.literal(TEST_NETWORK_NAME),costUnknownAccepted:z.literal(true)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'invalid_network_proposal'});requireScopeIdle();active=true;
    try{return await networkOperations().prepare(body.data.name,true,humanPrincipal);}finally{active=false;}
  });
  app.get('/api/networks/:id',async(req,reply)=>{const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_network_operation'});requireScopeIdle();active=true;try{const operations=networkOperations();await operations.verifyScope();return operations.get(id.data);}finally{active=false;}});
  app.post('/api/networks/:id/decision',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=z.object({decision:z.enum(['approve','reject']),digest:z.string().regex(/^[a-f0-9]{64}$/),reviewNonce:z.string().regex(/^[a-f0-9]{64}$/),acknowledge:z.literal(true)}).strict().safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'invalid_network_approval'});requireScopeIdle();active=true;
    try{return body.data.decision==='reject'?networkOperations().reject(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal):await networkOperations().approve(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal);}finally{active=false;}
  });
  app.post('/api/networks/:id/reconcile',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success||!z.object({}).strict().safeParse(req.body).success)return reply.code(400).send({error:'invalid_network_reconciliation'});requireScopeIdle();active=true;
    try{return await networkOperations().reconcile(id.data);}finally{active=false;}
  });
  app.post('/api/repairs',async(req,reply)=>{
    const body=z.object({source:z.enum(['fixture','selected','checkout-baseline']),consent:z.literal(true)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'consent_required'});
    requireScopeIdle();
    const selected=body.data.source==='selected'?scope():undefined;
    active=true;
    try{
      const result=selected?await repairs.create(await sources.capture(selected),`مخزن مجاز ${selected.appId}`):body.data.source==='checkout-baseline'?await repairs.checkoutBaseline():await repairs.fixture();
      if(selected)repairScopes.set(result.id,selected);return result;
    }finally{active=false;}
  });
  app.get('/api/repairs/:id',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_repair'});return repairs.get(id.data);
  });
  app.post('/api/repairs/:id/fix',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=z.object({consent:z.literal(true)}).strict().safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'consent_required'});
    requireScopeIdle();if(connecting)return reply.code(409).send({error:'busy'});
    const record=repairs.get(id.data);if(record.state!=='analyzed')return reply.code(409).send({error:'not_ready'});
    const selected=repairScopes.get(id.data);
    if(selected){const current=scope();if(JSON.stringify(current)!==JSON.stringify(selected)||sourceDigest(await sources.capture(current))!==record.sourceRevision)return reply.code(409).send({error:'source_changed'});}
    requireScopeIdle();if(selected&&JSON.stringify(scope())!==JSON.stringify(selected))return reply.code(409).send({error:'scope_changed'});
    active=true;reply.hijack();const headers:OutgoingHttpHeaders={};for(const [name,value]of Object.entries(reply.getHeaders()))if(value!==undefined)headers[name]=value;
    reply.raw.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    let finished=false;const close=()=>{if(!finished)repairs.cancel(id.data);};reply.raw.on('close',close);
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n');},10000);
    try{await repairs.fix(id.data,event=>{if(!reply.raw.destroyed)reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);});}
    finally{finished=true;clearInterval(heartbeat);reply.raw.off('close',close);reply.raw.end();active=false;}
  });
  app.get('/api/repairs/:id/zip',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_repair'});
    const repaired=await repairs.reviewedSource(id.data),selected=repairScopes.get(id.data);
    if(selected){if(JSON.stringify(scope())!==JSON.stringify(selected)||sourceDigest(await sources.capture(selected))!==repaired.view.sourceRevision)return reply.code(409).send({error:'source_changed'});}
    const zip=await packageRepairZip(repaired.files);if(zip.sourceRevision!==repaired.view.revision)return reply.code(409).send({error:'repair_changed'});
    reply.header('Content-Type','application/zip').header('Content-Disposition','attachment; filename="liara-checkout-repaired.zip"').header('X-Content-SHA256',zip.sha256);
    return reply.send(zip.bytes);
  });
  app.get('/api/demo/original-v1.zip',async(_req,reply)=>{
    const bytes=await readFile(resolve('.local/checkout-repair-v1/original-v1.zip'));
    const sha=hashBytes('sha256').update(bytes).digest('hex');
    if(sha!=='977ea37a37ea82d759d45196589e5dad61edbbf1c8501529055037b202813db2')return reply.code(409).send({error:'baseline_changed'});
    reply.header('Content-Type','application/zip').header('Content-Disposition','attachment; filename="liara-test-k-original-broken-v1.zip"').header('X-Content-SHA256',sha);return reply.send(bytes);
  });
  app.get('/api/demo/history',async()=>{
    const snapshotText=await readFile(resolve('.local/verification/liara-test-k-snapshot.json'),'utf8');
    if(hashBytes('sha256').update(snapshotText).digest('hex')!=='75b7d3252b71cc17b79416b1fe2ba42476525d51981608d53422e6bf170fd8c5')throw new Error('Historical evidence changed');
    const raw=JSON.parse(snapshotText) as {id?:unknown;appId?:unknown;fetchedAt?:unknown;logs?:{state?:unknown;evidence?:{data?:{timestamp?:unknown;message?:unknown}[]}}};
    if(raw.id!=='50717b1b-e292-4f3b-ac75-805f151e44ba'||raw.appId!=='liara-test-k'||raw.fetchedAt!=='2026-10-23T13:11:48.599Z'||raw.logs?.state!=='ok'||!Array.isArray(raw.logs.evidence?.data))throw new Error('Historical evidence unavailable');
    const events=raw.logs.evidence.data.filter(row=>typeof row.timestamp==='string'&&typeof row.message==='string'&&row.message.includes('CHECKOUT_COUPON_MISSING')).slice(0,5).map(row=>({timestamp:row.timestamp,code:'CHECKOUT_COUPON_MISSING'}));
    const source=await captureSource(resolve('.local/checkout-repair-v1/downloaded-baseline'));
    const archive=await readFile(resolve('.local/checkout-repair-v1/original-v1.zip'));
    const sourceMatch=sourceDigest(source)==='sha256:186804aeead1daaa9fa9238d4c360cbd451b773bb3800e1075212785afc1849d'&&hashBytes('sha256').update(archive).digest('hex')==='977ea37a37ea82d759d45196589e5dad61edbbf1c8501529055037b202813db2';
    return {historical:true,appId:'liara-test-k',releaseId:'000000000000000000000006',fetchedAt:raw.fetchedAt,events,sourceMatch};
  });
  app.get('/api/demo/live-check',async()=>{
    const paths=['/','/health','/api/checkout'];const checkedAt=new Date().toISOString();
    const results=await Promise.all(paths.map(async path=>{try{const response=await fetch('https://liara-test-k.liara.run'+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});await response.body?.cancel();return {path,status:response.status};}catch{return {path,status:null};}}));
    return {source:'live-http',checkedAt,results};
  });
  app.post('/api/repairs/:id/proposal',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=z.object({reviewed:z.literal(true),port:z.number().int().min(1).max(65535),scenario:z.enum(['success','upload_uncertain','release_failed','release_response_lost']).optional()}).strict().safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'review_required'});requireScopeIdle();
    active=true;try{
    const repaired=await repairs.reviewedSource(id.data);const fixture=repaired.view.fixture;
    if(!fixture&&(!services.liveDeploymentEnabled||!services.deployment))return reply.code(409).send({error:'live_deployment_disabled',message:'استقرار واقعی در این اجرا فعال نشده است.'});
    const selected=repairScopes.get(id.data);
    if(!fixture&&(!selected||JSON.stringify(scope())!==JSON.stringify(selected)))return reply.code(409).send({error:'scope_changed'});
    const adapter=fixture?fixtureDeployment(body.data.scenario):services.deployment!;
    const target=fixture?{...fixtureTarget}:await adapter.inspect(selected!.appId);
    if(!fixture&&target.accountId!==selected?.accountId)return reply.code(409).send({error:'scope_changed'});
    const artifact=await packageSource(repaired.files);const parameters={port:body.data.port,type:'node'};
    if(!fixture&&JSON.stringify(scope())!==JSON.stringify(selected))return reply.code(409).send({error:'scope_changed'});
    return operations.prepare({repair:repaired.view,target,artifact,parameters,fixture,fixtureScenario:fixture?body.data.scenario??'success':undefined,
      check:async()=>{await repairs.reviewedSource(id.data);if(!fixture){if(JSON.stringify(scope())!==JSON.stringify(selected)||sourceDigest(await sources.capture(selected!))!==repaired.view.sourceRevision)throw new Error('Source scope changed');}},
      execute:step=>adapter.deploy(target,artifact,parameters,step)},humanPrincipal);
    }finally{active=false;}
  });
  app.get('/api/operations/:id/review',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_proposal'});const view=operations.get(id.data,humanPrincipal);operationScope(view);return view;
  });
  app.get('/api/operations',async()=>operations.list().filter(view=>{try{operationScope(view);return true;}catch{return false;}}));
  app.get('/api/operations/:id/support-review',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(400).send({error:'invalid_operation'});
    requireScopeIdle();operationScope(operations.get(id.data,humanPrincipal));return operations.support.review(id.data,humanPrincipal);
  });
  app.post('/api/operations/:id/support-evidence',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=SupportEvidenceInput.safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'invalid_support_evidence'});
    requireScopeIdle();operationScope(operations.get(id.data,humanPrincipal));
    if(liara.redact(JSON.stringify(body.data))!==JSON.stringify(body.data))throw new ManualRecoveryError();
    return operations.support.record(id.data,humanPrincipal,body.data);
  });
  app.post('/api/operations/:id/reconcile',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);
    if(!id.success||!z.object({}).strict().safeParse(req.body).success)return reply.code(400).send({error:'invalid_reconciliation'});
    operationScope(operations.get(id.data,humanPrincipal));
    requireScopeIdle();active=true;
    try{return await operations.reconcile(id.data,humanPrincipal,context=>{
      if(context.fixture)return fixtureDeployment((context.scenario??'success') as FixtureScenario,context).reconcile(context);
      if(!services.deployment)return Promise.resolve({state:'manual',reason:'unavailable',checkedAt:new Date().toISOString(),evidence:[]});
      return services.deployment.reconcile(context);
    });}finally{active=false;}
  });
  app.post('/api/operations/:id/decision',async(req,reply)=>{
    const id=z.string().uuid().safeParse((req.params as {id:string}).id),body=z.object({decision:z.enum(['approve','reject']),digest:z.string().regex(/^[a-f0-9]{64}$/),reviewNonce:z.string().regex(/^[a-f0-9]{64}$/),acknowledge:z.literal(true)}).strict().safeParse(req.body);
    if(!id.success||!body.success)return reply.code(400).send({error:'invalid_approval'});requireScopeIdle();
    operationScope(operations.get(id.data,humanPrincipal));
    if(body.data.decision==='reject')return operations.reject(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal);
    active=true;try{return await operations.approve(id.data,body.data.digest,body.data.reviewNonce,humanPrincipal);}finally{active=false;}
  });
  app.get('/api/sources/candidates',async()=>{scope();return sources.candidates();});
  app.get('/api/sources/current',async(_req,reply)=>{
    if(sourceReading)return reply.code(409).send({error:'busy'});
    const target=scope();sourceReading=true;
    try{return await sources.get(target);}finally{sourceReading=false;}
  });
  app.post('/api/sources/local',async(req,reply)=>{
    const body=z.object({candidateId:z.string().uuid(),consent:z.literal(true)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'invalid_source'});
    requireScopeIdle();
    const target=scope();sourceBusy=true;
    try{return await sources.associateLocal(target,body.data.candidateId);}finally{sourceBusy=false;}
  });
  app.post('/api/sources/github',async(req,reply)=>{
    const body=z.object({owner:GitHubOwner,repo:GitHubRepo,consent:z.literal(true)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'invalid_source'});
    requireScopeIdle();
    const target=scope();sourceBusy=true;
    try{return await sources.associateGitHub(target,body.data.owner,body.data.repo);}finally{sourceBusy=false;}
  });
  app.post('/api/sources/disconnect',async()=>{requireScopeIdle();sources.disconnect(scope());return {disconnected:true};});
  app.post('/api/diagnosis',async(req,reply)=>{
    const body=z.object({problem:Problem,evidenceId:z.string().uuid(),consent:z.literal(true)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'invalid_diagnosis'});
    if(active||connecting||sourceBusy||runtime.status.state!=='ready')return reply.code(409).send({error:'not_ready'});
    const snapshot=liara.currentEvidence(body.data.evidenceId);
    const prepared=prepareDiagnosis(body.data.problem,snapshot,liara.evidencePrompt(snapshot.id));
    active=true; reply.hijack();
    const headers:OutgoingHttpHeaders={};
    for(const [name,value]of Object.entries(reply.getHeaders()))if(value!==undefined)headers[name]=value;
    reply.raw.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    const emit=(event:DiagnosisEvent)=>{if(!reply.raw.destroyed)reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);};
    let finished=false; const close=()=>{if(!finished)runtime.close();};reply.raw.on('close',close);
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n');},10000);
    try {
      emit({type:'progress',message:'شواهد پاک‌سازی‌شده برای بررسی اولیه به Codex ارسال شد.'});
      const items=new Map<string,string>(); let completed=false;
      await runtime.chat(prepared.prompt,event=>{
        if(event.type==='progress')emit(event);
        if(event.type==='delta')items.set(event.itemId,(items.get(event.itemId)??'')+event.text);
        if(event.type==='message')items.set(event.itemId,event.text);
        if(event.type==='done')completed=event.status==='completed';
      },{outputSchema:z.toJSONSchema(Finding),isolated:true});
      if(!completed)throw new Error('Incomplete diagnosis');
      liara.currentEvidence(snapshot.id); // Expiry and scope must still match at publication.
      const result=finishDiagnosis([...items.values()].at(-1)??'',prepared,text=>liara.redact(text));
      emit({type:'result',report:result});emit({type:'done',status:'completed'});
    }catch {emit({type:'error',message:'بررسی کامل نشد یا شواهد منقضی شده است. شواهد را تازه و اتصال Codex را بررسی کنید.'});emit({type:'done',status:'failed'});}
    finally{finished=true;clearInterval(heartbeat);reply.raw.off('close',close);reply.raw.end();active=false;}
  });
  app.get('/api/liara/status', async () => liara.status());
  app.get('/api/liara/apps', async () => { assertReadOnlyCapability('diagnostics'); return liara.apps(); });
  app.post('/api/liara/test-options',async(req,reply)=>{if(!z.object({}).strict().safeParse(req.body).success)return reply.code(400).send({error:'invalid_preflight'});requireScopeIdle();return liara.testOptions();});
  app.post('/api/liara/connect', async () => { requireScopeIdle(); assertReadOnlyCapability('diagnostics'); return liara.connect(); });
  app.post('/api/liara/disconnect', async () => {requireScopeIdle();operations.support.invalidateReviews();return liara.disconnect();});
  app.post('/api/liara/selection', async (req, reply) => {
    const body = z.object({ appId: AppId }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_app', message: 'شناسهٔ برنامه معتبر نیست.' });
    requireScopeIdle();
    return liara.select(body.data.appId);
  });
  app.post('/api/liara/refresh', async () => { requireScopeIdle();assertReadOnlyCapability('diagnostics'); return liara.refresh(); });
  app.post('/api/connect', async (_req, reply) => {
    if (active || connecting) return reply.code(409).send({ error: 'busy' });
    connecting = true;
    try { return { codex: await runtime.connect() }; } finally { connecting = false; }
  });
  app.post('/api/chat', async (req, reply) => {
    assertReadOnlyCapability('chat');
    const body = z.object({ message: z.string().trim().min(1).max(4000), evidenceId: z.string().uuid().optional() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_message' });
    if (active || connecting) return reply.code(409).send({ error: 'busy' });
    if (runtime.status.state !== 'ready') return reply.code(409).send({ error: 'not_ready' });
    // Only the server can construct evidence. No client-supplied log/metric object is trusted.
    const prompt = liara.redact(body.data.message) + (body.data.evidenceId ? liara.evidencePrompt(body.data.evidenceId) : '\n\nNO_CURRENT_LIARA_EVIDENCE: No current Liara evidence is attached to this turn. Earlier snapshots, if present in this conversation, are historical only. Do not present them as current website status; identify their original app and fetch time when discussing them.');
    active = true;
    reply.hijack();
    const headers: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) headers[name] = value;
    reply.raw.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': connected\n\n');
    let finished = false;
    const close = () => { if (!finished) runtime.close(); };
    reply.raw.on('close', close);
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n'); }, 10_000);
    try {
      await runtime.chat(prompt, event => {
        if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } catch {
      if (!reply.raw.destroyed) reply.raw.write('data: {"type":"error","code":"runtime_error","message":"ارتباط با Codex قطع شد."}\n\ndata: {"type":"done","status":"failed"}\n\n');
    } finally {
      finished = true; clearInterval(heartbeat); reply.raw.off('close', close); reply.raw.end(); active = false;
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof LiaraError || error instanceof SourceError || error instanceof OperationError || error instanceof ManualRecoveryError || error instanceof NetworkError || error instanceof ApplicationCreationError) return void reply.code(error.statusCode).send({ error: error.code, message: error.message });
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    void reply.code(status >= 400 && status < 500 ? status : 500).send({ error: status === 413 ? 'message_too_large' : 'request_failed' });
  });
  return app;
}
