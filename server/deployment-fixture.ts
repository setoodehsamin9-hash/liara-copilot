import {LiaraDeployment,type RecoveryContext} from './deployment.js';
export const fixtureTarget={accountId:'local-fixture',appId:'local-http500',projectId:'fixture-project',currentRelease:'fixture-base'};
export type FixtureScenario='success'|'upload_uncertain'|'release_failed'|'release_response_lost';
// Labeled local HTTP fixtures only. This fetch function NEVER accesses the network.
export function fixtureDeployment(scenario:FixtureScenario='success',receipt?:RecoveryContext){
 let releaseCreated=!!receipt?.releaseID;
 return new LiaraDeployment({token:'LOCAL-TEST-FIXTURE-NOT-A-CREDENTIAL',pollDelayMs:0,fetch:async(input,init)=>{
  const url=new URL(String(input));if(url.origin!=='https://api.liara.ir')throw new Error('Fixture origin');
  if(url.pathname==='/v1/me')return Response.json({user:{_id:fixtureTarget.accountId}});
  if(url.pathname===`/v1/projects/${fixtureTarget.appId}`)return Response.json({project:{_id:fixtureTarget.projectId,project_id:fixtureTarget.appId,type:'node'}});
  if(url.pathname.endsWith('/sources')){if(scenario==='upload_uncertain')throw new Error('SIMULATED ambiguous upload failure');return Response.json({sourceID:'fixture-source'});}
  if(init?.method==='POST'){releaseCreated=true;if(scenario==='release_response_lost')throw new Error('SIMULATED lost release response');return Response.json({releaseID:'fixture-release'});}
  if(url.pathname==='/v1/releases/fixture-release')return Response.json({release:{state:scenario==='release_failed'?'FAILED':'READY',status:'FIXTURE'}});
  return Response.json({currentRelease:releaseCreated?'fixture-release':fixtureTarget.currentRelease,releases:releaseCreated?[{_id:'fixture-release'}]:[]});
 }});
}
