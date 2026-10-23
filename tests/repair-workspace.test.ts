import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRepairWorkspace,runRepairTests,probeFixture} from '../server/repair-workspace.js';

test('an actual isolated worktree preserves the baseline and captures a real failing-to-passing regression',async()=>{
 const files={'app.mjs':'export function respond(){ return {status:500,body:"broken"}; }','tests/original.test.mjs':'import {test} from "node:test";import assert from "node:assert/strict";import {respond} from "../app.mjs";test("HTTP response is successful",()=>assert.equal(respond().status,200));'};
 const workspace=await createRepairWorkspace(resolve('.local','worktree-test-'+randomUUID()),files);
 assert.equal((await runRepairTests(workspace.files)).exitCode,1);assert.equal((await probeFixture(workspace.files)).status,500);
 await workspace.files.write('app.mjs','export function respond(){ return {status:200,body:"fixed"}; }');
 const result=await runRepairTests(workspace.files);assert.equal(result.exitCode,0);assert.equal((await probeFixture(workspace.files)).status,200);
 assert.match(await workspace.diff(),/-export function respond/);assert.equal(await readFile(resolve(workspace.baseline,'app.mjs'),'utf8'),files['app.mjs']);
});
test('the fixed test runner denies outside reads, network, writes and subprocesses',async()=>{
 const files={'tests/security.test.mjs':'import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import {spawnSync} from "node:child_process";import net from "node:net";test("permissions",async()=>{assert.throws(()=>fs.readFileSync(process.execPath));assert.throws(()=>fs.writeFileSync("owned.mjs","bad"));assert.throws(()=>spawnSync(process.execPath,["-e","1"]));await assert.rejects(new Promise((resolve,reject)=>{const socket=net.connect(443,"127.0.0.1");socket.on("error",reject);socket.on("connect",()=>{socket.destroy();resolve();});}),{code:"ERR_ACCESS_DENIED"});});'};
 const workspace=await createRepairWorkspace(resolve('.local','sandbox-test-'+randomUUID()),files);
 const result=await runRepairTests(workspace.files);assert.equal(result.exitCode,0,result.stdout+result.stderr);assert.match(result.stdout??'',/permissions/);
});
test('process.exit(0) cannot masquerade as a completed successful test run',async()=>{
 const workspace=await createRepairWorkspace(resolve('.local','early-exit-'+randomUUID()),{'tests/exit.test.mjs':'process.exit(0);'});
 assert.notEqual((await runRepairTests(workspace.files)).exitCode,0);
});
test('prototype JSON forgery and exit-code changes cannot turn failing test evidence into success',async()=>{
 const content='import {test} from "node:test";import assert from "node:assert/strict";Object.prototype.toJSON=function(){if(this.counts&&typeof this.success==="boolean")return {success:true,counts:{tests:1,passed:1,failed:0,skipped:0,todo:0,cancelled:0}};return this;};process.on("exit",()=>{process.exitCode=0;});test("actual failure",()=>assert.fail("must remain failed"));';
 const workspace=await createRepairWorkspace(resolve('.local','forged-summary-'+randomUUID()),{'tests/forged.test.mjs':content});assert.notEqual((await runRepairTests(workspace.files)).exitCode,0);
});
