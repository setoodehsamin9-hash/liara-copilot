import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {Operations} from '../server/operations.js';
import {ApplicationCreations,LiaraApplicationCreation} from '../server/application-creations.js';
import {LiaraDeployment} from '../server/deployment.js';
import {allowedInitialTarget,initialTarget} from '../server/initial-deployment-contract.js';
const teamId='000000000000000000000002',owner='000000000000000000000001',scope={kind:'team',teamId} as const;
const name='liara-copilot-checkout-20261023',network='000000000000000000000004',id='123456789012345678901234';
function fixture(oldIdentity=false){let exists=false,posts=0;const fetcher:typeof fetch=async(raw,init)=>{
 const url=new URL(String(raw));assert.equal(url.origin,'https://api.liara.ir');assert.equal(url.searchParams.get('teamID'),teamId);assert.equal(init?.redirect,'error');
 if(init?.method==='POST'){assert.equal(url.pathname,'/v1/projects');assert.deepEqual(JSON.parse(String(init.body)),{name,platform:'node',planID:'small-g2',bundlePlanID:'basic',network,readOnlyRootFilesystem:true});posts++;exists=true;return new Response(null,{status:200});}
 if(url.pathname==='/v1/me')return Response.json({user:{_id:owner},team:{_id:teamId},plans:{projects:{'small-g2':{available:true,region:'iran',RAM:{amount:0.5},CPU:{amount:0.5},volume:5,price:659.72}},projectBundlePlans:{'small-g2':{basic:{available:true,displayPrice:275000}}}}});
 if(url.pathname==='/v1/networks')return Response.json({networks:[{_id:network,name:'hamkharid-net'}]});
 if(url.pathname==='/v1/projects')return Response.json({projects:[{project_id:initialTarget.appId},...(exists?[{project_id:name}]:[])]});
 if(url.pathname.endsWith('/releases'))return Response.json({currentRelease:null,releases:[]});
  assert.equal(url.pathname,'/v1/projects/'+name);return Response.json({project:{_id:oldIdentity?initialTarget.projectId:id,project_id:name,type:'node',planID:'small-g2',bundlePlanID:'basic',network:{_id:network,name:'hamkharid-net'},readOnlyRootFilesystem:true,isDeployed:false}});
 };return {fetcher,posts:()=>posts};}

test('MOCK CLOUD: independent grant binds new name; old uncertain lock/consumed grant remain unchanged',async()=>{
 const f=fixture(),store=new Store(':memory:');try{
  new Operations(store);store.db.prepare("INSERT INTO operations(id,account,target,expires,state,lastStep) VALUES('old',?,?,0,'uncertain','upload_dispatched')").run(initialTarget.accountId,initialTarget.appId);
  store.db.prepare("INSERT INTO approvals VALUES('old','original','human',0,'consumed')").run();
  const before=store.db.prepare("SELECT * FROM operations WHERE id='old'").get(),adapter=new LiaraApplicationCreation({token:'FIXTURE-CREDENTIAL',scope,fetch:f.fetcher}),ops=new ApplicationCreations(store,adapter);
  const proposal=await ops.prepare({name,networkId:network},'human');assert.equal(proposal.action.body.name,name);assert.equal(proposal.state,'pending');assert.equal(f.posts(),0);
  await assert.rejects(ops.prepare({name:initialTarget.appId,networkId:network},'human'));
  await assert.rejects(ops.approve(proposal.id,'original',proposal.reviewNonce,'human',true));
  await assert.rejects(ops.approve(proposal.id,proposal.digest,proposal.reviewNonce,'model',true));
  assert.equal((await ops.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true)).applicationId,id);
  await assert.rejects(ops.approve(proposal.id,proposal.digest,proposal.reviewNonce,'human',true));assert.equal(f.posts(),1);
  assert.deepEqual(store.db.prepare("SELECT * FROM operations WHERE id='old'").get(),before);assert.equal((store.db.prepare("SELECT state FROM approvals WHERE id='old'").get() as {state:string}).state,'consumed');
  const deploy=new LiaraDeployment({token:'FIXTURE-CREDENTIAL',scope,fetch:f.fetcher});assert.deepEqual(await deploy.inspectInitial(name),{accountId:initialTarget.accountId,appId:name,projectId:id,currentRelease:null});assert.equal(f.posts(),1);
 }finally{store.close();}
});
test('exact new target fails closed for personal scope, wrong network/name, old project ID and prior-target reuse',async()=>{
 const deny:typeof fetch=async()=>{throw Error('must not dispatch');};
 const personal=new LiaraApplicationCreation({token:'FIXTURE-CREDENTIAL',fetch:deny});await assert.rejects(personal.inspect(network,name));await assert.rejects(personal.createOnce(network,name));
 const team=new LiaraApplicationCreation({token:'FIXTURE-CREDENTIAL',scope,fetch:deny});await assert.rejects(team.inspect('wrong',name));
 assert.equal(allowedInitialTarget({...initialTarget,appId:name}),false);assert.equal(allowedInitialTarget({...initialTarget,appId:'other',projectId:id}),false);assert.equal(allowedInitialTarget({...initialTarget,appId:name,projectId:id}),true);
});
test('MOCK CLOUD: old immutable ID under new name never confirms creation or enables replay',async()=>{
 const f=fixture(true),store=new Store(':memory:');try{
  const ops=new ApplicationCreations(store,new LiaraApplicationCreation({token:'FIXTURE-CREDENTIAL',scope,fetch:f.fetcher}));
  const p=await ops.prepare({name,networkId:network},'human');const result=await ops.approve(p.id,p.digest,p.reviewNonce,'human',true);
  assert.equal(result.state,'uncertain');assert.equal(result.configurationVerified,false);assert.equal(result.applicationId,undefined);assert.equal(f.posts(),1);
  await assert.rejects(ops.approve(p.id,p.digest,p.reviewNonce,'human',true));assert.equal(f.posts(),1);
 }finally{store.close();}
});
