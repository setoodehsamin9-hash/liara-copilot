import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import type {Runtime} from '../server/codex.js';
test('repair consent, source scope and cloud review endpoints are protected by the existing session',async()=>{
 const runtime:Runtime={status:{state:'disconnected',message:'test',verifiedConversation:false},async connect(){return this.status;},async chat(){},close(){}};
 const host='127.0.0.1:4310',origin=`http://${host}`,app=createApp(runtime,origin);
 try{const token=(await app.inject({url:'/api/session',headers:{host}})).json().token;const headers={host,origin,'x-liara-session':token};
  assert.equal((await app.inject({url:'/api/repair/status',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/repair/status',headers:{host}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/repairs',headers,payload:{source:'fixture',consent:false}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/repairs',headers,payload:{source:'selected',consent:true}})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/operations/00000000-0000-4000-8000-000000000001/decision',headers,payload:{decision:'approve',digest:'x',reviewNonce:'x',acknowledge:true,command:'deploy'}})).statusCode,400);
 }finally{await app.close();}
});
