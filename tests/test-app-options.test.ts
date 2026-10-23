import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiaraObservability} from '../server/liara.js';
test('MOCK NETWORK: test-app preflight projects only available paid Iran plans and existing networks, never credentials',async()=>{
 const methods:string[]=[];const service=new LiaraObservability('FIXTURE-CREDENTIAL-NEVER-REAL',{fetch:async(url,init)=>{
  methods.push(init?.method??'GET');const path=new URL(String(url)).pathname;
  if(path==='/v1/me')return Response.json({user:{_id:'fixture-owner',storage:{secretKey:'DO_NOT_LEAK'}},plans:{projects:{'fixture-g2':{available:true,region:'iran',RAM:{amount:0.512},CPU:{amount:0.5},volume:5,price:1000},free:{available:true,region:'iran'},'disabled-g2':{available:false}},projectBundlePlans:{'fixture-g2':{basic:{available:true,displayPrice:750000},secret:'DO_NOT_LEAK'}}}});
  if(path==='/v1/networks')return Response.json({networks:[{_id:'fixture-network',name:'آزمایشی',createdAt:'2026-10-22T00:00:00Z',secret:'DO_NOT_LEAK'}]});
  return Response.json({projects:[]});
 }});
 await service.connect();const options=await service.testOptions();
 assert.equal(options.plans.length,1);assert.equal(options.plans[0]?.id,'fixture-g2');assert.equal(options.plans[0]?.ramGB,0.512);assert.equal(options.networks[0]?.id,'fixture-network');
 assert.equal(options.costTotalKnown,false);assert.equal(JSON.stringify(options).includes('DO_NOT_LEAK'),false);assert.ok(methods.every(method=>method==='GET'));
});
test('MOCK NETWORK: malformed catalog types and duplicate network identities fail closed rather than inventing a plan',async()=>{
 for(const mode of ['price','network']){
  const service=new LiaraObservability('FIXTURE-CREDENTIAL-NEVER-REAL',{fetch:async(url)=>{
   const path=new URL(String(url)).pathname;
   if(path==='/v1/me')return Response.json({user:{_id:'owner'},plans:{projects:{'plan-g2':{available:true,region:'iran',RAM:{amount:0.512},CPU:{amount:0.5},volume:5,price:mode==='price'?'1000':1000}},projectBundlePlans:{'plan-g2':{basic:{available:true,displayPrice:750000}}}}});
   if(path==='/v1/networks')return Response.json({networks:[{_id:'network-1',name:'same'},{_id:'network-1',name:'same'}]});
   return Response.json({projects:[]});
  }});
  await service.connect();await assert.rejects(service.testOptions());
 }
});
