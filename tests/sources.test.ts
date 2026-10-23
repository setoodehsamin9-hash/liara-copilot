import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, readFile, unlink, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SourceRegistry, SourceError } from '../server/sources.js';

const scope = { accountId: 'fixture-owner', appId: 'fixture-app' };
async function localFixture() {
  const root = resolve('.local', 'source-test-' + randomUUID());
  await mkdir(join(root,'.git','refs','heads'), { recursive: true });
  await writeFile(join(root,'.git','HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(root,'.git','refs','heads','main'), 'a'.repeat(40)+'\n');
  await writeFile(join(root,'private-source.ts'), 'SOURCE_CONTENT_MUST_NOT_BE_READ');
  return root;
}

test('explicit local candidate association reads bounded HEAD metadata only, with scope isolation', async () => {
  const root = await localFixture(); const before = await readFile(join(root,'.git','HEAD'),'utf8');
  const sources = new SourceRegistry({ roots: [root] }); const candidates = await sources.candidates();
  assert.equal(candidates.length, 1);
  const association = await sources.associateLocal(scope, candidates[0]!.id);
  assert.equal(association.kind, 'local'); assert.equal(association.revision, 'a'.repeat(40)); assert.equal(association.branch, 'main');
  assert.equal(association.access, 'metadata-only');
  assert.equal(JSON.stringify(association).includes('SOURCE_CONTENT'), false);
  assert.equal(await sources.get({ ...scope, appId: 'other' }), null);
  await assert.rejects(sources.associateLocal(scope, '../outside'));
  assert.equal(await readFile(join(root,'.git','HEAD'),'utf8'), before);
  await writeFile(join(root,'.git','refs','heads','main'), 'b'.repeat(40)+'\n');
  assert.equal((await sources.get(scope))?.revision, 'b'.repeat(40));
});

test('symlink/junction, escaped refs, linked git dirs and alternates fail closed', async () => {
  const root = await localFixture(); const outside = await localFixture();
  const linkedRoot = root + '-junction'; await symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = new SourceRegistry({ roots: [linkedRoot] });
  await assert.rejects(linked.associateLocal(scope, (await linked.candidates())[0]!.id), (e: unknown) => e instanceof SourceError);
  const sources = new SourceRegistry({ roots: [root] }); const id = (await sources.candidates())[0]!.id;
  await writeFile(join(root,'.git','HEAD'), 'ref: refs/heads/../../outside\n');
  await assert.rejects(sources.associateLocal(scope,id));
  await writeFile(join(root,'.git','HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(root,'.git','commondir'), outside);
  await assert.rejects(sources.associateLocal(scope,id));
  await unlink(join(root,'.git','commondir'));
  await mkdir(join(root,'.git','objects','info'),{recursive:true});
  await writeFile(join(root,'.git','objects','info','alternates'),outside);
  await assert.rejects(sources.associateLocal(scope,id));
});
test('hardlinked HEAD metadata and internal ref junctions are rejected',async()=>{
  const root=await localFixture();const sources=new SourceRegistry({roots:[root]});const id=(await sources.candidates())[0]!.id;
  await link(join(root,'.git','HEAD'),join(root,'head-hardlink'));
  await assert.rejects(sources.associateLocal(scope,id));
  await unlink(join(root,'head-hardlink'));
  const other=await localFixture();const junction=join(root,'.git','refs','heads','linked');
  await symlink(join(other,'.git','refs','heads'),junction,process.platform==='win32'?'junction':'dir');
  await writeFile(join(root,'.git','HEAD'),'ref: refs/heads/linked/main\n');
  await assert.rejects(sources.associateLocal(scope,id));
});
test('a pending metadata refresh cannot resurrect a disconnected association',async()=>{
  const root=await localFixture();const sources=new SourceRegistry({roots:[root]});
  await sources.associateLocal(scope,(await sources.candidates())[0]!.id);
  const pending=sources.get(scope);sources.disconnect(scope);
  assert.equal(await pending,null);assert.equal(await sources.get(scope),null);
});

test('unborn and detached HEADs are honest; repository config is never executed or followed', async () => {
  const root = await localFixture(); const sources = new SourceRegistry({ roots: [root] }); const id = (await sources.candidates())[0]!.id;
  await writeFile(join(root,'.git','HEAD'), 'ref: refs/heads/new-branch\n');
  await writeFile(join(root,'.git','config'), '[include]\n path = C:/DO_NOT_READ/credentials\n[core]\n fsmonitor = unsafe-command\n');
  const unborn = await sources.associateLocal(scope,id); assert.equal(unborn.revision,null);
  await writeFile(join(root,'.git','HEAD'), 'c'.repeat(40)+'\n');
  const detached = await sources.get(scope); assert.equal(detached?.revision,'c'.repeat(40)); assert.equal(detached?.branch,null);
});

test('GitHub association fetches only fixed-host metadata and never returns the backend token', async () => {
  const requests: { path: string; method: string | undefined }[] = [];
  const sources = new SourceRegistry({ roots: [], githubToken: 'fixture-github-token-not-real', fetch: async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin,'https://api.github.com'); assert.equal(init?.redirect,'error');
    requests.push({path:url.pathname,method:init?.method});
    if (url.pathname === '/repos/fixture/project') return Response.json({ full_name:'fixture/project', default_branch:'main', private:true, clone_url:'https://secret@evil.test' });
    return Response.json({ commit: { sha: 'd'.repeat(40) } });
  } });
  const association = await sources.associateGitHub(scope,'fixture','project');
  assert.equal(association.revision,'d'.repeat(40)); assert.equal(association.access,'metadata-only');
  assert.equal(JSON.stringify(association).includes('token-not-real'),false); assert.equal(JSON.stringify(association).includes('evil.test'),false);
  assert.deepEqual(requests.map(r=>r.method),['GET','GET']);
  await assert.rejects(sources.associateGitHub(scope,'..','project'));
});
test('explicit source capture reads only an associated repository and excludes local secrets',async()=>{
 const root=await localFixture();await writeFile(join(root,'.env'),'DO_NOT_FORWARD=secret');
 const registry=new SourceRegistry({roots:[root]});await registry.associateLocal(scope,(await registry.candidates())[0]!.id);
 const captured=await registry.capture(scope);assert.equal(captured['private-source.ts'],'SOURCE_CONTENT_MUST_NOT_BE_READ');assert.equal(captured['.env'],undefined);
 await assert.rejects(registry.capture({...scope,appId:'unauthorized'}));
});
test('GITHUB HTTP FIXTURE: pinned source blobs are bounded; symlinks and truncated trees fail closed',async()=>{
 for(const mode of ['regular','symlink','truncated']){
  const commit='a'.repeat(40),tree='b'.repeat(40),blob='c'.repeat(40),content='export const status = 500;';
  const registry=new SourceRegistry({fetch:async input=>{
   const path=new URL(String(input)).pathname;
   if(path==='/repos/fixture/project')return Response.json({full_name:'fixture/project',default_branch:'main'});
   if(path.endsWith('/branches/main'))return Response.json({commit:{sha:commit}});
   if(path.includes('/git/commits/'))return Response.json({sha:commit,tree:{sha:tree}});
   if(path.includes('/git/trees/'))return Response.json({truncated:mode==='truncated',tree:[{path:'app.mjs',type:'blob',mode:mode==='symlink'?'120000':'100644',sha:blob,size:Buffer.byteLength(content)}]});
   if(path.endsWith('/blobs/'+blob))return Response.json({sha:blob,encoding:'base64',content:Buffer.from(content).toString('base64'),size:Buffer.byteLength(content)});
   throw new Error('Unexpected URL');
  }});
  await registry.associateGitHub(scope,'fixture','project');
  if(mode==='regular')assert.equal((await registry.capture(scope))['app.mjs'],content);else await assert.rejects(registry.capture(scope));
 }
});
