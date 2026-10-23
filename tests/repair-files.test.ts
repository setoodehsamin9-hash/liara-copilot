import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureSource,RepairFiles} from '../server/repair-files.js';

test('bounded source capture omits secrets/dependencies and never follows a source junction',async()=>{
 const root=resolve('.local','capture-'+randomUUID());await mkdir(root,{recursive:true});
 await writeFile(join(root,'app.mjs'),'export const status = 500;');await writeFile(join(root,'.env'),'TOKEN=NEVER_COPY');await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','secret.js'),'NEVER_COPY');
 const snapshot=await captureSource(root);
 assert.deepEqual(Object.keys(snapshot),['app.mjs']);assert.equal(snapshot['app.mjs'],'export const status = 500;');
 const outside=resolve('.local','outside-'+randomUUID());await mkdir(outside);await writeFile(join(outside,'private.mjs'),'NEVER_COPY');await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(captureSource(root));
});
test('repair tools reject traversal, immutable tests, private files and hardlinks while allowing scoped edits',async()=>{
 const root=resolve('.local','repair-files-'+randomUUID());await mkdir(join(root,'tests'),{recursive:true});await writeFile(join(root,'app.mjs'),'old');await writeFile(join(root,'tests','original.test.mjs'),'original');
 const files=new RepairFiles(root,['app.mjs','tests/original.test.mjs']);
 await files.write('app.mjs','fixed');assert.equal(await readFile(join(root,'app.mjs'),'utf8'),'fixed');
 await files.write('tests/repair-regression.test.mjs','regression');assert.equal(await files.read('tests/repair-regression.test.mjs'),'regression');
 for(const path of ['../outside.mjs','.git/config','.env','tests/original.test.mjs','C:/outside.mjs'])await assert.rejects(files.write(path,'bad'));
});
