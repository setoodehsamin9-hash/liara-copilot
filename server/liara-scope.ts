import {z} from 'zod';
import {VERIFIED_TEAM_ID} from './scope-constants.js';
export {VERIFIED_TEAM_ID} from './scope-constants.js';
export const AccountScope=z.discriminatedUnion('kind',[z.object({kind:z.literal('personal')}).strict(),z.object({kind:z.literal('team'),teamId:z.literal(VERIFIED_TEAM_ID)}).strict()]);
export type AccountScope=z.infer<typeof AccountScope>;
export const personalScope:AccountScope=Object.freeze({kind:'personal'});
export function validatedScope(value:unknown=personalScope):AccountScope{return Object.freeze(AccountScope.parse(value));}
export function scopedUrl(path:string,scope:AccountScope=personalScope){
 const url=new URL(path,'https://api.liara.ir');if(url.origin!=='https://api.liara.ir'||!path.startsWith('/')||url.searchParams.has('teamID'))throw new Error('Invalid scoped URL');
 const selected=validatedScope(scope);if(selected.kind==='team')url.searchParams.set('teamID',selected.teamId);return url.toString();
}
export function accountKey(ownerId:string,scope:AccountScope=personalScope){if(!/^[A-Za-z0-9_-]{1,100}$/.test(ownerId))throw new Error('Invalid owner');return scope.kind==='personal'?ownerId:`${ownerId}:team:${scope.teamId}`;}
export function accountInScope(key:string,scope:AccountScope=personalScope){return scope.kind==='team'?key.endsWith(`:team:${scope.teamId}`)&&key.split(':').length===3:!key.includes(':');}
export function verifyAccount(input:unknown,scope:AccountScope=personalScope){
 const data=z.object({user:z.object({_id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),fullname:z.string().max(500).nullish(),isTeam:z.boolean().optional(),balance:z.number().finite().optional()}),team:z.unknown().optional()}).parse(input);
 const selected=validatedScope(scope);let name=data.user.fullname??null,balance=data.user.balance??null;
 if(selected.kind==='personal'){if(data.user.isTeam||data.team!=null)throw new Error('Scope mismatch');}
 else{const team=z.object({_id:z.literal(selected.teamId),teamName:z.string().max(200).optional(),balance:z.number().finite().optional()}).parse(data.team);name=team.teamName??'تیم';balance=team.balance??null;}
 return {...data.user,_id:accountKey(data.user._id,selected),ownerId:data.user._id,fullname:name,isTeam:false,scope:selected,balance};
}
