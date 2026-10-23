import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Server} from 'node:http';
test('local cloud-compatible fixture serves genuine HTTP 500 and an independent health endpoint without any cloud resource',async()=>{
 const fixture=await import(pathToFileURL(resolve('fixtures/liara-http500-site/server.mjs')).href) as {createWebsite:()=>Server};
 const server=fixture.createWebsite();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{const address=server.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  const broken=await fetch(origin+'/');assert.equal(broken.status,500);assert.match(await broken.text(),/خطای داخلی/);
  const health=await fetch(origin+'/healthz');assert.equal(health.status,200);assert.equal(await health.text(),'ok');
  const named=await fetch(origin+'/?name=Sara');assert.equal(named.status,200);assert.equal(await named.text(),'سلام Sara');
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
