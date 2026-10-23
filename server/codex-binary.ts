import {existsSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
/** Server-side executable discovery; no browser-controlled path is accepted. */
export function codexExecutable(env:NodeJS.ProcessEnv=process.env){
 if(env.LIARA_CODEX_BIN)return env.LIARA_CODEX_BIN;
 if(env.CODEX_CLI_PATH)return env.CODEX_CLI_PATH;
 if(process.platform==='win32'&&env.LOCALAPPDATA){
  const root=join(env.LOCALAPPDATA,'OpenAI','Codex','bin');
  if(existsSync(root)){
   const found=readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>join(root,entry.name,'codex.exe')).filter(path=>existsSync(path)&&statSync(path).isFile()).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
   if(found[0])return found[0];
  }
 }
 return 'codex';
}
