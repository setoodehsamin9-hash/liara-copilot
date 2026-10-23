import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {captureSource} from './repair-files.js';
import {createRepairWorkspace,runRepairTests,execute,sourceDigest} from './repair-workspace.js';
import {packageSource,archiveDigest} from './deployment.js';
import {initialDefinition,type InitialEvidence} from './initial-deployment-contract.js';
import {createServer} from 'node:net';
const manifest=['README.md','app.mjs','package.json','server.mjs','tests/checkout-regression.test.mjs','tests/smoke.test.mjs'];
export async function prepareInitialBaseline(){
 const source=await captureSource(resolve('fixtures/liara-checkout-site'));
 if(JSON.stringify(Object.keys(source).sort())!==JSON.stringify(manifest))throw Error('Unexpected initial source manifest');
 const root=resolve('.local/initial-deployment',randomUUID());
 const workspace=await createRepairWorkspace(root,source);
 const smoke=await runRepairTests(workspace.files,['tests/smoke.test.mjs']);
 const regression=await runRepairTests(workspace.files,['tests/checkout-regression.test.mjs']);
 if(smoke.exitCode!==0||regression.exitCode!==1||!smoke.testSummary?.complete||!regression.testSummary?.complete)throw Error('Initial baseline evidence incomplete');
 // Allocate in trusted code, then grant only this port. Source cannot call the product backend.
 const reservation=createServer();await new Promise<void>((done,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',done);});
 const address=reservation.address();if(!address||typeof address==='string')throw Error('No local probe port');const port=address.port;
 await new Promise<void>((done,fail)=>reservation.close(error=>error?fail(error):done()));
 const script=`import {createWebsite} from './server.mjs';const server=createWebsite();await new Promise(r=>server.listen(${port},'127.0.0.1',r));try{const rows=[];for(const path of ['/','/health','/api/checkout']){const r=await fetch('http://127.0.0.1:${port}'+path);await r.text();rows.push({path,status:r.status});}process.stdout.write('INITIAL_HTTP '+JSON.stringify(rows));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}`;
 const probe=await execute(process.execPath,['--permission',`--allow-fs-read=${workspace.files.root}`,`--allow-net=127.0.0.1:${port}`,'--input-type=module','-e',script],workspace.files.root,{timeout:10000,limit:16384});
 if(probe.exitCode!==0||probe.timedOut)throw Error('Local HTTP execution failed');
 const http:InitialEvidence['http']=JSON.parse(probe.stdout.slice(probe.stdout.indexOf('INITIAL_HTTP ')+13));
 if(JSON.stringify(http)!==JSON.stringify(initialDefinition.expectedHTTP))throw Error('Local HTTP behavior mismatch');
 const artifact=await packageSource(workspace.files),archivePath=join(root,'source.tar.gz');
 await writeFile(archivePath,artifact.bytes,{flag:'wx'});
 const diff=Object.entries(source).sort().map(([path,text])=>{const lines=(text.endsWith('\n')?text.slice(0,-1):text).split('\n');return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line=>'+'+line).join('\n')}\n${text.endsWith('\n')?'':'\\ No newline at end of file\n'}`;}).join('');
 const evidence:InitialEvidence={kind:'intentional-http500-baseline-v1',revision:artifact.revision,smoke,regression,http,diff};
 await writeFile(join(root,'evidence.json'),JSON.stringify({evidence,artifact:{digest:artifact.digest,revision:artifact.revision,manifest:artifact.manifest},branch:workspace.branch,baseline:workspace.baseline,httpProbe:{exitCode:probe.exitCode,stderr:probe.stderr}},null,2),{flag:'wx'});
 return {artifact,evidence,archivePath,baselinePath:workspace.baseline,worktreePath:workspace.files.root,branch:workspace.branch,async check(){
  if(sourceDigest(await workspace.files.snapshot())!==artifact.revision||sourceDigest(await captureSource(workspace.baseline))!==artifact.revision||archiveDigest(await readFile(archivePath))!==artifact.digest)throw Error('Initial artifact/source changed');
 }};
}
