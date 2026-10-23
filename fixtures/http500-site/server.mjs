import {createServer} from 'node:http';
import {respond} from './app.mjs';
const port=Number(process.env.PORT||4399);
createServer((req,res)=>{const result=respond(`http://127.0.0.1:${port}${req.url}`);res.writeHead(result.status,{'Content-Type':'text/plain; charset=utf-8'});res.end(result.body);}).listen(port,'127.0.0.1');
