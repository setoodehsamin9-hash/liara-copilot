import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNetworkLogs} from '../server/liara-logs.js';
import {LiaraObservability,ReadOnlyLiaraClient,LiaraError} from '../server/liara.js';
import {VERIFIED_TEAM_ID} from '../server/scope-constants.js';

const now=()=>Date.parse('2026-10-23T13:00:00Z');
const ns=(date:string)=>String(BigInt(Date.parse(date))*1_000_000n);
const group=(date:string,message:string)=>({metaData:{releaseId:'release-actual',unknown:'discard'},values:[[ns(date),JSON.stringify({_entry:message,type:'stderr',token:'envelope-secret'})]]});
test('network parser sorts precise timestamps, unwraps only known fields and fails closed',()=>{
  const data={data:[group('2026-10-23T12:59:01Z','second'),group('2026-10-23T12:59:00Z','first')]};
  const rows=parseNetworkLogs(data);
  assert.deepEqual(rows.map(r=>r.message),['first','second']);
  assert.equal(rows[0]?.datetime,'2026-10-23T12:59:00.000Z');
  assert.equal(rows[0]?.releaseId,'release-actual');
  assert.ok(!JSON.stringify(rows).includes('envelope-secret'));
  assert.deepEqual(parseNetworkLogs({data:[]}),[]);
  for(const bad of [{},{data:[{metaData:{releaseId:'x'},values:[['garbage','{}']]}]},{data:[{metaData:{releaseId:'x'},values:[[ns('2026-10-23T12:59:00Z'),'not-json']]}]}])assert.throws(()=>parseNetworkLogs(bad));
});
test('malformed network logs are a safe schema error with no endpoint fallback or retry',async()=>{
  let calls=0;
  const client=new ReadOnlyLiaraClient('fixture-token',{fetch:async()=>{calls++;return Response.json({data:[{metaData:{releaseId:'x'},values:[[ns('2026-10-23T12:59:00Z'),'secret-not-json']]}]});}});
  await assert.rejects(client.logs('liara-test-k','2026-10-23T12:30:00.000Z',true),(error:unknown)=>error instanceof LiaraError&&error.code==='schema'&&!error.message.includes('secret'));
  assert.equal(calls,1);
});
test('listed team app uses only scoped network GET logs; project/current-release identity and redaction survive',async()=>{
  const calls:URL[]=[];
  const app={_id:'project-actual',project_id:'liara-test-k',network:{_id:'network-1'},type:'node',status:'ACTIVE',isDeployed:true,envs:[{value:'env-secret'}]};
  const service=new LiaraObservability('test-secret-only-12345',{now,scope:{kind:'team',teamId:VERIFIED_TEAM_ID},fetch:async(input,init)=>{
    const url=new URL(String(input));calls.push(url);assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(url.searchParams.get('teamID'),VERIFIED_TEAM_ID);
    if(url.pathname==='/v1/me')return Response.json({user:{_id:'owner'},team:{_id:VERIFIED_TEAM_ID}});
    if(url.pathname==='/v1/projects')return Response.json({projects:[app]});
    if(url.pathname==='/v1/projects/liara-test-k')return Response.json({project:app});
    if(url.pathname==='/v2/projects/liara-test-k/logs')return Response.json({data:[group('2026-10-23T12:59:00Z','checkout_failed password=hidden-value')]});
    if(url.pathname.endsWith('/releases'))return Response.json({currentRelease:'release-actual',releases:[{_id:'release-newer',state:'FAILED'},{_id:'release-actual',state:'READY'}]});
    if(url.pathname.includes('/metrics/'))return Response.json({result:[]});
    throw new Error('Unexpected endpoint');
  }});
  await service.connect();service.select('liara-test-k');const snapshot=await service.refresh();
  assert.equal(snapshot.logs.state,'ok');assert.equal(snapshot.details.state,'ok');
  if(snapshot.logs.state==='ok'){assert.equal(snapshot.logs.evidence.endpoint,'/v2/projects/liara-test-k/logs');assert.equal(snapshot.logs.evidence.data[0]?.releaseId,'release-actual');}
  if(snapshot.details.state==='ok')assert.equal(snapshot.details.evidence.data.projectId,'project-actual');
  if(snapshot.releases.state==='ok')assert.deepEqual(snapshot.releases.evidence.data.map(r=>r.isCurrent),[false,true]);else assert.fail();
  const logs=calls.filter(u=>u.pathname.endsWith('/logs'));assert.equal(logs.length,1);assert.equal(logs[0]?.searchParams.get('start'),String(now()/1000-1800));assert.equal(logs[0]?.searchParams.get('direction'),'forward');assert.equal(logs[0]?.searchParams.get('last_lines'),'false');
  for(const secret of ['env-secret','hidden-value','envelope-secret'])assert.ok(!JSON.stringify(snapshot).includes(secret));
  assert.match(service.evidencePrompt(snapshot.id),/checkout_failed/);
});
