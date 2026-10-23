import {z} from 'zod';
import {scopedUrl,VERIFIED_TEAM_ID,personalScope} from './liara-scope.js';
const identity=z.object({user:z.object({_id:z.string()}),team:z.object({_id:z.string()}).nullish()});
type Probe={url:string;method:'GET';authorizationScheme:'Bearer';status:number|null;bodyState:'not-read'|'validated'|'unreadable';ownerMatches:boolean|null;teamMatches:boolean|null};
/** Explicit local investigation only. Never installs a scope or returns upstream bodies/headers. */
export async function diagnoseLiaraAuth(token:string,fetcher:typeof fetch=fetch){
 if(!/^[\x21-\x7e]{16,8192}$/.test(token)||/^Bearer\s/i.test(token)||/^["']|["']$/.test(token))throw new Error('invalid_credential_input');
 async function probe(url:string,team:boolean):Promise<Probe>{
  const result:Probe={url,method:'GET',authorizationScheme:'Bearer',status:null,bodyState:'not-read',ownerMatches:null,teamMatches:null};
  try{
   const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6000)});
   result.status=response.status;
   if(!response.ok){await response.body?.cancel().catch(()=>{});return result;}
   result.bodyState='unreadable';if(!response.body)return result;
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();return result;}chunks.push(part.value);}}finally{reader.releaseLock();}
   const data=identity.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   result.bodyState='validated';result.ownerMatches=data.user._id==='000000000000000000000001';result.teamMatches=team?data.team?._id===VERIFIED_TEAM_ID:data.team==null;
  }catch{/* Never serialize untrusted response, credential or transport exception text. */}
  return result;
 }
 const personal=await probe(scopedUrl('/v1/me',personalScope),false);
 const team=await probe(scopedUrl('/v1/me',{kind:'team',teamId:VERIFIED_TEAM_ID}),true);
 return {checkedAt:new Date().toISOString(),personal,team,expiration:'unknown',credentialSource:'local-hidden-input',scopeChanged:false};
}
