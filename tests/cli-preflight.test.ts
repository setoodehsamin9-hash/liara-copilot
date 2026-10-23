import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import {existsSync} from 'node:fs';
const {assertCliRead}=await import(pathToFileURL(resolve('scripts/liara-cli-read-policy.mjs')).href) as {assertCliRead:(method:string,url:URL,count:number)=>void};
const team='000000000000000000000002',base='https://api.liara.ir',app='liara-copilot-test-20261022';
test('CLI policy: exact GET scope only; no mutation, fallback, redirect host, other target or unlimited reads',()=>{
 for(const path of ['/v1/me','/v2/teams','/v1/projects',`/v1/projects/${app}`,`/v1/projects/${app}/releases?page=1&count=10`]){
  const url=new URL(path,base);url.searchParams.set('teamID',team);assert.doesNotThrow(()=>assertCliRead('GET',url,0));
  for(const method of ['POST','PUT','DELETE','PATCH','HEAD'])assert.throws(()=>assertCliRead(method,url,0));
  assert.throws(()=>assertCliRead('GET',url,20));url.searchParams.set('teamID','another-team');assert.throws(()=>assertCliRead('GET',url,0));
 }
 for(const url of [`${base}/v1/projects`,`${base}/v1/projects/${app}?teamID=`,`${base}/v1/projects/other?teamID=${team}`,`${base}/v2/projects/${app}/sources?teamID=${team}`,`https://evil.invalid/v1/me`,`http://api.liara.ir/v1/me`,`https://user:secret@api.liara.ir/v1/me`])assert.throws(()=>assertCliRead('GET',new URL(url),0));
 // Official whoami deliberately checks personal identity before team membership.
 assert.doesNotThrow(()=>assertCliRead('GET',new URL(base+'/v1/me?teamID='),0));
});
test('REAL LOCAL: official CLI Got cancels oversized streams before buffering all; unsolicited gzip is not decoded',{skip:existsSync('.local/official-cli/node_modules/got/dist/source/index.js')?false:'Optional official CLI is not installed'},async()=>{
 const {limitCliDownload,cliReadLimit}=await import(pathToFileURL(resolve('scripts/liara-cli-read-policy.mjs')).href);
 const {default:got}=await import(pathToFileURL(resolve('.local/official-cli/node_modules/got/dist/source/index.js')).href);
 let delivered=0;
 const compressed=gzipSync('x'.repeat(2*cliReadLimit));
 const server=createServer((req,res)=>{
  if(req.url==='/gzip'){assert.equal(req.headers['accept-encoding'],'identity');res.writeHead(200,{'content-encoding':'gzip'});res.end(compressed);return;}
  if(req.url==='/known')res.writeHead(200,{'content-length':String(8*cliReadLimit)});
  let sent=0;const timer=setInterval(()=>{sent+=65536;delivered+=65536;res.write(Buffer.alloc(65536));if(sent>=8*cliReadLimit){clearInterval(timer);res.end();}},2);
  res.once('close',()=>clearInterval(timer));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=got.extend({decompress:false,headers:{'accept-encoding':'identity'},handlers:[limitCliDownload],followRedirect:false,retry:{limit:0},timeout:{request:5000}});
 try{
  for(const path of ['/chunked','/known']){delivered=0;await assert.rejects(client(`http://127.0.0.1:${address.port}`+path).json());assert.ok(delivered<8*cliReadLimit);}
  await assert.rejects(client(`http://127.0.0.1:${address.port}/gzip`).json());
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
test('CLI preflight: malformed/missing tokens fail before CLI import/network and never appear in output',()=>{
 for(const secret of ['', 'Bearer FIXTURE-SECRET-NOT-REAL',' FIXTURE-SECRET-NOT-REAL','"FIXTURE-SECRET-NOT-REAL"']){
  const result=spawnSync(process.execPath,['scripts/liara-cli-preflight.mjs'],{cwd:process.cwd(),env:{...process.env,LIARA_CLI_PREFLIGHT_TOKEN:secret},encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,1);assert.equal(result.stderr,'');const safe=JSON.parse(result.stdout);assert.equal(safe.state,'read_only_preflight_incomplete');assert.equal(safe.cloudMutations,0);
  if(secret)assert.equal(result.stdout.includes(secret),false);
 }
});
