import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {CodexRpc} from '../server/rpc.js';
import {CodexRuntime} from '../server/codex.js';
import {Store} from '../server/store.js';
const catalog=resolve('.local','PROTOCOL-FIXTURE-CATALOG.json');
type Handler=Parameters<CodexRpc['setRequestHandler']>[0];
class ProtocolRpc extends CodexRpc{
 handler?:Handler;safeCatalog=true;knownModel=true;experimental=false;registered:unknown;
 exercise?:(handler:Handler)=>Promise<void>;
 override setRequestHandler(handler:Handler){this.handler=handler;super.setRequestHandler(handler);}
 override start(){} override close(){} override notify(){}
 override async request(method:string,raw:unknown):Promise<unknown>{
  const params=raw as Record<string,unknown>;
  if(method==='initialize'){this.experimental=(params.capabilities as {experimentalApi:boolean}).experimentalApi;return {userAgent:'PROTOCOL FIXTURE'};}
  if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
  if(method==='config/read')return {config:{model_catalog_json:this.safeCatalog?catalog:'unexpected',features:Object.fromEntries(['shell_tool','plugins','apps','hooks','multi_agent','computer_use','browser_use','image_generation','view_image','workspace_dependencies'].map(key=>[key,false])),mcp_servers:{}}};
  if(method==='model/list')return {data:[{model:this.knownModel?'fixture-model':'unknown-model',isDefault:true}]};
  if(method==='thread/start'){this.registered=params.dynamicTools;return {thread:{id:'scoped-thread'},sandbox:{type:'readOnly',networkAccess:false},approvalPolicy:'never',model:'fixture-model'};}
  if(method==='mcpServerStatus/list')return {data:[],nextCursor:null};
  if(method==='thread/unsubscribe')return {};
  if(method==='turn/start'){setImmediate(()=>{void this.exercise?.(this.handler!).then(()=>this.emit('notification','turn/completed',{threadId:'scoped-thread',turn:{status:'completed'}})).catch(()=>this.emit('notification','turn/completed',{threadId:'scoped-thread',turn:{status:'failed'}}));});return {turn:{id:'turn-1',status:'inProgress'}};}
  throw new Error('Unexpected method');
 }
}
test('PROTOCOL FIXTURE: scoped callbacks deny approval requests, other threads/tools and replay; clear after completion',async()=>{
 const rpc=new ProtocolRpc(),store=new Store(':memory:');let runs=0,completed=false;
 const runtime=new CodexRuntime({executable:'fixture',cwd:resolve('.local/repair-protocol'),store,createRpc:()=>rpc,allowScopedTools:true,repairCatalog:{path:catalog,models:['fixture-model']}});
 const args={threadId:'scoped-thread',turnId:'turn-1',callId:'call-1',namespace:null,tool:'read_source',arguments:{path:'app.mjs'}};
 rpc.exercise=async handler=>{
  await assert.rejects(handler('item/permissions/requestApproval',args));
  await assert.rejects(handler('item/tool/call',{...args,threadId:'other'}));
  await assert.rejects(handler('item/tool/call',{...args,tool:'deploy'}));
  const result=await handler('item/tool/call',args) as {success:boolean};assert.equal(result.success,true);
  await assert.rejects(handler('item/tool/call',args));
 };
 try{assert.equal((await runtime.connect()).state,'ready');
  await runtime.chat('PROTOCOL FIXTURE',event=>{if(event.type==='done')completed=event.status==='completed';},{isolated:true,tools:[{name:'read_source',description:'test',schema:{type:'object'},async run(){runs++;return 'safe fixture';}}]});
  assert.equal(completed,true);assert.equal(runs,1);assert.equal(rpc.experimental,true);assert.ok(Array.isArray(rpc.registered));await assert.rejects(rpc.handler!('item/tool/call',{...args,callId:'after-completion'}));
 }finally{runtime.close();store.close();}
});
test('PROTOCOL FIXTURE: unapplied catalog and unknown models fail closed before tool turns',async()=>{
 for(const kind of ['catalog','model']){const rpc=new ProtocolRpc(),store=new Store(':memory:');rpc.safeCatalog=kind!=='catalog';rpc.knownModel=kind!=='model';
  const runtime=new CodexRuntime({executable:'fixture',cwd:resolve('.local/repair-protocol'),store,createRpc:()=>rpc,allowScopedTools:true,repairCatalog:{path:catalog,models:['fixture-model']}});
  try{assert.equal((await runtime.connect()).state,'error');assert.equal(rpc.registered,undefined);}finally{runtime.close();store.close();}
 }
});
