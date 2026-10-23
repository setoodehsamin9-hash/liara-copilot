// Trusted backend runner, outside the model-writable workspace.
import {readFileSync,writeSync} from 'node:fs';
import {run} from 'node:test';
const writeFd=writeSync,write=text=>writeFd(1,text),stringify=JSON.stringify.bind(JSON),createNull=Object.create.bind(Object,null),isInteger=Number.isSafeInteger;
const keys=Object.freeze(['tests','passed','failed','skipped','todo','cancelled']);
const input=JSON.parse(readFileSync(0,'utf8'));
const stream=run({files:input.files,isolation:'none',concurrency:1});
let summary;
for await(const event of stream){
  if(event.type==='test:summary'&&!event.data.file){
    const proof=createNull(),counts=createNull();let valid=true;
    for(let index=0;index<keys.length;index++){const key=keys[index],value=event.data.counts[key];if(typeof value!=='number'||!isInteger(value)||value<0)valid=false;counts[key]=value;}
    proof.success=event.data.success===true;proof.counts=counts;summary=valid?proof:undefined;
  }
  if(event.type==='test:pass'||event.type==='test:fail')write(`${event.type}: ${event.data.name}${event.data.details?.error?.message?' — '+event.data.details.error.message:''}\n`);
}
if(summary){write(`\nLIARA_TEST_COMPLETE_${input.nonce} ${stringify(summary)}\n`);process.exitCode=summary.success?0:1;}
else process.exitCode=1;
