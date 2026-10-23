import {createHash} from 'node:crypto';
import type {RepairFiles} from './repair-files.js';
import {sourceDigest} from './repair-workspace.js';

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes:Buffer){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]!^(c>>>8);return(c^0xffffffff)>>>0;}
export async function packageRepairZip(files:RepairFiles){
 const source=await files.snapshot(),paths=Object.keys(source).sort();
 if(!paths.length||paths.length>200)throw new Error('Invalid repair archive');
 const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0,total=0;
 for(const path of paths){
  const name=Buffer.from(path,'utf8'),data=Buffer.from(source[path]!,'utf8');total+=data.length;
  if(name.length>240||data.length>131072||total>2097152)throw new Error('Repair archive too large');
  const crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,name,data);centrals.push(central,name);offset+=local.length+name.length+data.length;
 }
 const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(paths.length,8);end.writeUInt16LE(paths.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...locals,directory,end]);
 return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),sourceRevision:sourceDigest(source),paths};
}
