import {z} from 'zod';
import {verifyAccount,personalScope,type AccountScope} from './liara-scope.js';
const Id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),number=z.number().finite().nonnegative();
export type TestAppOptions={scope?:AccountScope;billing?:{balanceRaw:number|null;unit:'unknown'};source:'liara-api';accountId:string;fetchedAt:string;endpoints:string[];plans:{id:string;region:'iran';ramGB:number;cpuCores:number;diskGB:number;hourlyPriceRaw:number;monthlyHardwareFromCLI:number;baseBundle:'basic';baseBundleDisplayPrice:number}[];networks:{id:string;name:string}[];costTotalKnown:false};
/** Official CLI-observed catalog, strictly projected; no raw account object escapes. */
export function projectTestOptions(accountInput:unknown,networkInput:unknown,clean:(text:string)=>string,scope:AccountScope=personalScope):TestAppOptions{
 const account=z.object({user:z.object({_id:Id,isTeam:z.boolean().optional()}),team:z.unknown().optional(),plans:z.object({projects:z.record(z.string(),z.unknown()),projectBundlePlans:z.record(z.string(),z.record(z.string(),z.unknown()))})}).parse(accountInput);
 const identity=verifyAccount(accountInput,scope);
 const entries=Object.entries(account.plans.projects);if(entries.length>1000)throw new Error('Catalog limit');
 const plans:TestAppOptions['plans']=[];
 for(const [id,input]of entries){
  const flags=z.object({available:z.boolean(),region:z.string().optional()}).parse(input);
  if(!flags.available||flags.region!=='iran'||id==='free'||!id.includes('g2'))continue;
  Id.parse(id);const plan=z.object({RAM:z.object({amount:number.positive()}),CPU:z.object({amount:number.positive()}),volume:number,price:number}).parse(input);
  const basicInput=account.plans.projectBundlePlans[id]?.basic;if(basicInput===undefined)continue;
  const basic=z.object({available:z.boolean(),displayPrice:number}).parse(basicInput);if(!basic.available)continue;
  if(clean(id)!==id)throw new Error('Unsafe plan ID');
  plans.push({id,region:'iran',ramGB:plan.RAM.amount,cpuCores:plan.CPU.amount,diskGB:plan.volume,hourlyPriceRaw:plan.price,monthlyHardwareFromCLI:plan.price*720,baseBundle:'basic',baseBundleDisplayPrice:basic.displayPrice});
 }
 const networks=z.object({networks:z.array(z.object({_id:Id,name:z.string().min(1).max(200)})).max(200)}).parse(networkInput).networks.map(row=>({id:row._id,name:clean(row.name)}));
 if(new Set(networks.map(row=>row.id)).size!==networks.length||new Set(networks.map(row=>row.name)).size!==networks.length||networks.some(row=>clean(row.id)!==row.id)||clean(account.user._id)!==account.user._id)throw new Error('Ambiguous network/account');
 plans.sort((a,b)=>a.ramGB-b.ramGB||a.cpuCores-b.cpuCores||a.hourlyPriceRaw-b.hourlyPriceRaw);
 return {scope,billing:{balanceRaw:identity.balance,unit:'unknown'},source:'liara-api',accountId:identity._id,fetchedAt:new Date().toISOString(),endpoints:['/v1/me','/v1/networks'],plans,networks,costTotalKnown:false};
}
