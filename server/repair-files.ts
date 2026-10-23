import {readdir,mkdir,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {safePath,boundedMetadata,SourceError} from './sources.js';
import {redactSecrets} from './liara.js';

const skipped=new Set(['.git','node_modules','dist','dist-server','build','coverage','vendor']);
export function allowedSource(path:string){
 return path.length<=240&&path.split('/').every(part=>/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)&&!skipped.has(part.toLowerCase())&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)&&!part.endsWith('.'))&&/\.(mjs|cjs|js|ts|tsx|jsx|json|css|html|md)$/.test(path)&&!/(?:secret|credential|private[._-]?key|package-lock|yarn\.lock)/i.test(path);
}
export async function captureSource(root:string,redact:(text:string)=>string=redactSecrets):Promise<Record<string,string>>{
 const files:Record<string,string>=Object.create(null);let bytes=0,visited=0;
 async function walk(directory:string,prefix:string,depth:number){
  if(depth>12)throw new SourceError('unsafe_path');
  await safePath(directory,root);
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(++visited>2000)throw new SourceError('invalid_source');
   if(skipped.has(entry.name.toLowerCase())||entry.name.startsWith('.'))continue;
   const name=prefix+entry.name,path=join(directory,entry.name);const info=await safePath(path,root);
   if(info.isDirectory())await walk(path,name+'/',depth+1);
   else if(allowedSource(name)){
    const content=await boundedMetadata(path,root,131072);
    if(content.includes('\0')||redact(content)!==content)continue;
    bytes+=Buffer.byteLength(content);if(Object.keys(files).length>=200||bytes>2097152)throw new SourceError('invalid_source');
    files[name]=content;
   }
  }
 }
 await walk(root,'',0);return files;
}

export class RepairFiles{
 private readonly known:Set<string>;
 private readonly originals:Set<string>;
 constructor(readonly root:string,paths:string[],private redact:(text:string)=>string=redactSecrets){this.known=new Set(paths);this.originals=new Set(paths.filter(path=>/\.test\.mjs$/.test(path)));}
 paths(){return [...this.known].sort();}
 async read(path:string){
  if(!allowedSource(path)||!this.known.has(path))throw new SourceError('unsafe_path');
  const content=await boundedMetadata(join(this.root,...path.split('/')),this.root,131072);
  if(this.redact(content)!==content)throw new SourceError('unsafe_path');return content;
 }
 async write(path:string,content:string){
  if(!allowedSource(path)||this.originals.has(path)||(!this.known.has(path)&&path!=='tests/repair-regression.test.mjs')||(/(?:^|\/)tests?\/|\.test\./.test(path)&&path!=='tests/repair-regression.test.mjs')||Buffer.byteLength(content)>131072||content.includes('\0')||this.redact(content)!==content)throw new SourceError('unsafe_path');
  const target=join(this.root,...path.split('/'));const parent=dirname(target);
  if(!this.known.has(path)){
   await safePath(this.root,this.root);await mkdir(join(this.root,'tests'),{recursive:true});await safePath(parent,this.root);
   const file=await open(target,'wx');try{await file.writeFile(content,'utf8');}finally{await file.close();}this.known.add(path);
  }else{
   const before=await safePath(target,this.root);if(!before.isFile()||before.nlink!==1)throw new SourceError('unsafe_path');
   const file=await open(target,'r+');try{const stat=await file.stat();if(stat.ino!==before.ino||stat.dev!==before.dev||stat.nlink!==1)throw new SourceError('unsafe_path');await safePath(target,this.root);await file.truncate(0);await file.writeFile(content,'utf8');}finally{await file.close();}
  }
  await safePath(target,this.root);
 }
 async snapshot(){const result:Record<string,string>={};let bytes=0;for(const path of this.paths()){result[path]=await this.read(path);bytes+=Buffer.byteLength(result[path]!);if(bytes>2097152)throw new SourceError('invalid_source');}return result;}
}
