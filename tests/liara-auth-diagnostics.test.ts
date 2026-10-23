import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseLiaraAuth} from '../server/liara-auth-diagnostics.js';
const secret='FIXTURE-LOCAL-API-TOKEN',teamId='000000000000000000000002';
test('MOCK AUTH: same token, two fixed GETs, no fallback/retry; safe identity projection',async()=>{
 const calls:string[]=[];
 const result=await diagnoseLiaraAuth(secret,async(input,init)=>{
  calls.push(String(input));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+secret);
  return Response.json({user:{_id:'000000000000000000000001',storageKey:secret},...(calls.length===2?{team:{_id:teamId,balance:2000000}}:{}),password:secret});
 });
 assert.deepEqual(calls,['https://api.liara.ir/v1/me','https://api.liara.ir/v1/me?teamID='+teamId]);
 assert.equal(result.personal.status,200);assert.equal(result.team.status,200);assert.equal(result.team.teamMatches,true);
 assert.equal(result.personal.ownerMatches,true);assert.equal(JSON.stringify(result).includes(secret),false);
});
test('MOCK AUTH: personal 200/team 401 remain distinct upstream statuses',async()=>{
 let n=0;const result=await diagnoseLiaraAuth(secret,async()=>++n===1?Response.json({user:{_id:'other'}}):new Response(secret,{status:401}));
 assert.equal(result.personal.status,200);assert.equal(result.personal.ownerMatches,false);assert.equal(result.team.status,401);assert.equal(result.team.teamMatches,null);assert.equal(n,2);
});
test('MOCK AUTH: no retries after 401, outage, or untrusted error text',async()=>{
 let n=0;const result=await diagnoseLiaraAuth(secret,async()=>{if(++n===1)return new Response(secret,{status:401});throw new Error(secret);});
 assert.equal(n,2);assert.equal(result.personal.status,401);assert.equal(result.team.status,null);assert.equal(JSON.stringify(result).includes(secret),false);
});
test('MOCK AUTH: malformed input sends no requests and never silently normalizes',async()=>{
 for(const token of [' '+secret,secret+' ','Bearer '+secret,'"'+secret+'"','short','']){
  let n=0;await assert.rejects(diagnoseLiaraAuth(token,async()=>{n++;throw Error();}),/invalid_credential_input/);assert.equal(n,0);
 }
});
test('MOCK AUTH: wrong/missing team identity is never an authorized team',async()=>{
 const result=await diagnoseLiaraAuth(secret,async()=>Response.json({user:{_id:'other'},team:{_id:'wrong'}}));assert.equal(result.team.teamMatches,false);
});
test('MOCK AUTH: oversized success body is discarded and projected as unreadable',async()=>{
 const result=await diagnoseLiaraAuth(secret,async()=>new Response('x'.repeat(1048577)));assert.equal(result.team.status,200);assert.equal(result.team.bodyState,'unreadable');
});
