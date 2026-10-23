import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {captureSource,RepairFiles} from '../server/repair-files.js';
import {sourceDigest} from '../server/repair-workspace.js';
import {packageRepairZip} from '../server/repair-zip.js';

test('reviewed repair ZIP contains exactly the tested source files and stable digest',async()=>{
 const root=resolve('fixtures/http500-site'),source=await captureSource(root),files=new RepairFiles(root,Object.keys(source));
 const archive=await packageRepairZip(files);
 assert.equal(archive.sourceRevision,sourceDigest(source));
 assert.equal(archive.sha256,createHash('sha256').update(archive.bytes).digest('hex'));
 const entries=new Map<string,string>();let offset=0;
 while(archive.bytes.readUInt32LE(offset)===0x04034b50){
  const length=archive.bytes.readUInt32LE(offset+18),nameLength=archive.bytes.readUInt16LE(offset+26);
  const name=archive.bytes.subarray(offset+30,offset+30+nameLength).toString('utf8');
  entries.set(name,archive.bytes.subarray(offset+30+nameLength,offset+30+nameLength+length).toString('utf8'));
  offset+=30+nameLength+length;
 }
 assert.deepEqual(Object.fromEntries(entries),Object.fromEntries(Object.entries(source).sort(([a],[b])=>a.localeCompare(b))));
 assert.equal(archive.bytes.readUInt32LE(offset),0x02014b50);
 assert.equal(archive.bytes.readUInt32LE(archive.bytes.length-22),0x06054b50);
});
