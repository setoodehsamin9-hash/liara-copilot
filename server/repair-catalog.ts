import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {execute,cleanEnvironment} from './repair-workspace.js';
const Model=z.object({slug:z.string().min(1),apply_patch_tool_type:z.unknown()}).passthrough();
export type RepairCatalog={path:string;models:string[]};
export async function prepareRepairCatalog(executable:string):Promise<RepairCatalog>{
 const env=cleanEnvironment();for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','CODEX_HOME'])if(process.env[key])env[key]=process.env[key];
 const result=await execute(executable,['debug','models','--bundled'],process.cwd(),{env,limit:2097152,sanitize:false});
 if(result.exitCode!==0)throw new Error('Cannot validate bundled Codex model catalog');
 const data=z.object({models:z.array(Model).min(1)}).passthrough().parse(JSON.parse(result.stdout));
 const path=resolve('.local','repair-models.json');await mkdir(resolve('.local'),{recursive:true});
 await writeFile(path,JSON.stringify({...data,models:data.models.map(model=>({...model,apply_patch_tool_type:null}))}));
 const verified=z.object({models:z.array(Model)}).parse(JSON.parse(await readFile(path,'utf8')));
 if(verified.models.some(model=>model.apply_patch_tool_type!==null))throw new Error('Unsafe model catalog');
 return {path,models:verified.models.map(model=>model.slug)};
}
