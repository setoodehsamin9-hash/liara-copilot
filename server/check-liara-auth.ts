import {diagnoseLiaraAuth} from './liara-auth-diagnostics.js';
const token=process.env.LIARA_API_TOKEN;
delete process.env.LIARA_API_TOKEN;
try{
 if(!token)throw new Error('invalid_credential_input');
 console.log(JSON.stringify(await diagnoseLiaraAuth(token),null,2));
}catch{
 console.error('invalid_credential_input: enter only the raw API token, without Bearer, quotes or whitespace.');
 process.exitCode=1;
}
