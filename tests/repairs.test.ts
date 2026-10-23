import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Repairs} from '../server/repairs.js';
import type {Runtime} from '../server/codex.js';
function protocolFixture(regression:string):Runtime{
 return {status:{state:'ready',message:'MODEL PROTOCOL FIXTURE ONLY',verifiedConversation:false},async connect(){return this.status;},close(){},async chat(_text,emit,options){
  const tools=options?.tools!;const read=await tools.find(tool=>tool.name==='read_source')!.run({path:'app.mjs'}) as {content:string};
  await tools.find(tool=>tool.name==='write_source')!.run({path:'app.mjs',content:read.content.replace("new URL(url).searchParams.get('name').trim()","(new URL(url).searchParams.get('name') ?? '').trim()")});
  await tools.find(tool=>tool.name==='write_source')!.run({path:'tests/repair-regression.test.mjs',content:regression});
  emit({type:'message',itemId:'fixture',text:'Protocol fixture; actual source tests run separately.'});emit({type:'done',status:'completed'});
 }};
}
test('MODEL PROTOCOL FIXTURE: empty regression cannot yield a verified repair despite a working source change',async()=>{
 const repairs=new Repairs({runtimeFactory:async()=>protocolFixture('')});const initial=await repairs.fixture();await repairs.fix(initial.id,()=>{});
 const result=repairs.get(initial.id);assert.equal(result.afterTests?.exitCode,0);assert.equal(result.state,'failed');await assert.rejects(repairs.reviewedSource(initial.id));
});
test('MODEL PROTOCOL FIXTURE: actual new regression must fail before the change and pass afterward',async()=>{
 const regression='import {test} from "node:test";import assert from "node:assert/strict";import {respond} from "../app.mjs";test("default greeting regression",()=>assert.equal(respond("http://127.0.0.1/").status,200));';
 const repairs=new Repairs({runtimeFactory:async()=>protocolFixture(regression)});const initial=await repairs.fixture();await repairs.fix(initial.id,()=>{});
 const result=repairs.get(initial.id);assert.equal(result.state,'review');assert.equal(result.regressionBefore?.exitCode,1);assert.equal(result.regressionBefore?.testSummary?.failed,1);assert.equal(result.afterTests?.exitCode,0);assert.equal(result.afterHttp?.status,200);
});
