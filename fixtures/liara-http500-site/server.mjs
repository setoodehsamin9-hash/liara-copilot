// SEPARATE TEST APPLICATION. Never deploy without exact creation/deployment approvals.
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {respond} from './app.mjs';
export function createWebsite(){
 return createServer((req,res)=>{
  const url=new URL(req.url??'/','http://localhost');
  const result=url.pathname==='/healthz'?{status:200,body:'ok'}:respond(url.href);
  res.writeHead(result.status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(result.body);
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
 createWebsite().listen(port,'0.0.0.0',()=>console.log('Dedicated Liara test fixture listening on port '+port));
}
