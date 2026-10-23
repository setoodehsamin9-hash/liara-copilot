import {RepairFiles,allowedSource} from './repair-files.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {redactSecrets} from './liara.js';
import {z} from 'zod';

export type CommandResult={command:string;exitCode:number;stdout:string;stderr:string;startedAt:string;finishedAt:string;timedOut:boolean;testSummary?:{complete:boolean;total:number;passed:number;failed:number}};
export function cleanEnvironment():NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={};for(const key of ['PATH','Path','PATHEXT','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 return env;
}
export async function execute(executable:string,args:string[],cwd:string,options:{timeout?:number;env?:NodeJS.ProcessEnv;limit?:number;sanitize?:boolean;input?:string}={}):Promise<CommandResult>{
 const startedAt=new Date().toISOString();
 return new Promise((resolveResult,reject)=>{
  const child=spawn(executable,args,{cwd,env:options.env??cleanEnvironment(),shell:false,windowsHide:true,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});
  child.stdin?.on('error',()=>{});child.stdin?.end(options.input);
  let stdout='',stderr='',timedOut=false,overflow=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},options.timeout??30000);
  const collect=(kind:'stdout'|'stderr',value:Buffer)=>{if(stdout.length+stderr.length+value.length>(options.limit??65536)){overflow=true;child.kill();return;}if(kind==='stdout')stdout+=value.toString('utf8');else stderr+=value.toString('utf8');};
  child.stdout!.on('data',(value:Buffer)=>collect('stdout',value));child.stderr!.on('data',(value:Buffer)=>collect('stderr',value));
  child.on('error',()=>{clearTimeout(timer);reject(new Error('Local executable could not start'));});
  child.on('close',code=>{clearTimeout(timer);const clean=(text:string)=>options.sanitize===false?text:redactSecrets(text.replaceAll(cwd,'[repair workspace]'));resolveResult({command:[executable===process.execPath?'node':executable,...args].join(' ').replaceAll(cwd,'[repair workspace]'),exitCode:overflow||timedOut?-1:code??-1,stdout:clean(stdout),stderr:clean(stderr),startedAt,finishedAt:new Date().toISOString(),timedOut});});
 });
}
async function git(cwd:string,args:string[]){
 const result=await execute('git',['--no-pager','--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.autocrlf=false',...args],cwd,{env:{...cleanEnvironment(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'},limit:262144});
 if(result.exitCode!==0)throw new Error('Isolated Git operation failed');return result.stdout;
}
export function sourceDigest(files:Record<string,string>){return 'sha256:'+createHash('sha256').update(JSON.stringify(Object.keys(files).sort().map(path=>[path,files[path]]))).digest('hex');}
export async function createRepairWorkspace(root:string,source:Record<string,string>,redact:(text:string)=>string=redactSecrets){
 const repo=join(root,'repository'),worktree=join(root,'worktree'),baseline=join(root,'baseline');
 await mkdir(repo,{recursive:true});await mkdir(baseline);
 await git(repo,['init','--initial-branch=baseline','--template=']);
 const branch='repair/'+randomUUID();await git(repo,['worktree','add','--orphan','-b',branch,worktree]);
 if(Object.keys(source).length===0||Object.keys(source).length>200||Object.entries(source).some(([path,content])=>!allowedSource(path)||redact(content)!==content))throw new Error('Invalid source snapshot');
 for(const [path,content] of Object.entries(source)){
  for(const base of [worktree,baseline]){const target=join(base,...path.split('/'));await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
 }
 const paths=Object.keys(source);for(let index=0;index<paths.length;index+=20)await git(worktree,['add','--',...paths.slice(index,index+20)]);
 const files=new RepairFiles(worktree,paths,redact);
 return {files,baseline,branch,revision:sourceDigest(source),async diff(){
  const added=files.paths().filter(path=>!paths.includes(path));if(added.length)await git(worktree,['add','--intent-to-add','--',...added]);
  return git(worktree,['diff','--no-ext-diff','--no-textconv','--',...files.paths()]);
 }};
}
export async function runRepairTests(files:RepairFiles,only?:string[]):Promise<CommandResult>{
 if(Number(process.versions.node.split('.')[0])<26)throw new Error('Repair tests require Node 26+ network permissions');
 const tests=only??files.paths().filter(path=>/\.test\.mjs$/.test(path));
 if(tests.some(path=>!files.paths().includes(path)||!/\.test\.mjs$/.test(path)))throw new Error('Invalid test plan');
 if(tests.length===0||tests.length>20)throw new Error('No supported test plan: Node .test.mjs files required');
 await files.snapshot();
 const runner=resolve('scripts/repair-test-runner.mjs'),nonce=randomUUID().replaceAll('-','');
 const result=await execute(process.execPath,['--permission',`--allow-fs-read=${files.root}`,`--allow-fs-read=${runner}`,'--disable-proto=throw',runner],files.root,{input:JSON.stringify({nonce,files:tests.map(path=>join(files.root,...path.split('/')))})});
 const marker=`LIARA_TEST_COMPLETE_${nonce} `;const line=result.stdout.split(/\r?\n/).find(line=>line.startsWith(marker));
 const schema=z.object({success:z.boolean(),counts:z.object({tests:z.number().int().min(0),passed:z.number().int().min(0),failed:z.number().int().min(0),skipped:z.number(),todo:z.number(),cancelled:z.number()})});
 let summary:z.infer<typeof schema>|undefined;try{summary=schema.parse(JSON.parse(line?.slice(marker.length)??''));}catch{/* Missing proof fails closed. */}
 result.stdout=result.stdout.split(/\r?\n/).filter(line=>!line.startsWith(marker)).join('\n');
 result.command='node --permission [bounded source read; no write/network/subprocess] trusted-runner '+tests.join(' ');
 result.testSummary={complete:!!summary,total:summary?.counts.tests??0,passed:summary?.counts.passed??0,failed:summary?.counts.failed??0};
 if(!summary||summary.counts.tests===0||summary.counts.cancelled||summary.counts.skipped||summary.counts.todo||(result.exitCode===0&&(!summary.success||summary.counts.failed!==0||summary.counts.passed!==summary.counts.tests)))result.exitCode=-1;
 if(!summary)result.stderr+='\nIncomplete trusted test report.';
 return result;
}
export async function probeFixture(files:RepairFiles,path='/'):Promise<{status:number;body:string;fetchedAt:string}>{
 await files.read('app.mjs');
 // The HTTP listener is trusted host code. Source evaluation has NO network permission.
 const server=createServer(async(req,res)=>{
  try{
   if(path!=='/'&&path!=='/api/checkout'&&path!=='/health')throw new Error('Invalid fixture probe');
   const script='import {respond} from "./app.mjs";const result=respond("http://127.0.0.1'+path+'");process.stdout.write(JSON.stringify(result));';
   const result=await execute(process.execPath,['--permission',`--allow-fs-read=${files.root}`,'--input-type=module','-e',script],files.root,{timeout:5000,limit:8192});
   if(result.exitCode!==0)throw new Error('Fixture probe failed');
   const data=JSON.parse(result.stdout) as {status:unknown;body:unknown};if(!Number.isInteger(data.status)||Number(data.status)<100||Number(data.status)>599||typeof data.body!=='string')throw new Error('Invalid probe response');
   res.writeHead(Number(data.status),{'Content-Type':'text/plain; charset=utf-8'});res.end(data.body.slice(0,4096));
  }catch{res.writeHead(502);res.end('Fixture execution failed');}
 });
 await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
 try{const address=server.address();if(!address||typeof address==='string')throw new Error('No local listener');const response=await fetch(`http://127.0.0.1:${address.port}${path}`,{signal:AbortSignal.timeout(7000),redirect:'error'});return {status:response.status,body:(await response.text()).slice(0,4096),fetchedAt:new Date().toISOString()};}
 finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}
