import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {respond} from './app.mjs';
export function createWebsite(){return createServer((req,res)=>{
 const result=req.method==='GET'?respond(new URL(req.url??'/','http://localhost').href):{status:405,body:'method not allowed'};
 res.writeHead(result.status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(result.body);
});}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
 createWebsite().listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'listening',port})));
}
