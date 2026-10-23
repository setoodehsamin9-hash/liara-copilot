import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareInitialBaseline} from '../server/initial-deployment.js';
import {readFile,writeFile} from 'node:fs/promises';
import {archiveDigest} from '../server/deployment.js';
test('REAL LOCAL: isolated immutable broken baseline has real200/200/500, passing smoke and failing regression',async()=>{
 const baseline=await prepareInitialBaseline();
 assert.deepEqual(baseline.evidence.http,[{path:'/',status:200},{path:'/health',status:200},{path:'/api/checkout',status:500}]);
 assert.equal(baseline.evidence.smoke.exitCode,0);assert.equal(baseline.evidence.regression.exitCode,1);
 assert.equal(archiveDigest(await readFile(baseline.archivePath)),baseline.artifact.digest);
 assert.deepEqual(baseline.artifact.manifest,['README.md','app.mjs','package.json','server.mjs','tests/checkout-regression.test.mjs','tests/smoke.test.mjs']);
 await baseline.check();assert.ok(baseline.artifact.revision.startsWith('sha256:'));
 await writeFile(baseline.archivePath,'tampered');await assert.rejects(baseline.check(),/changed/);
});
