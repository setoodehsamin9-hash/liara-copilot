import type {CommandResult} from './repair-workspace.js';
import {NEW_TEST_APPLICATION_NAME} from './application-creation-contract.js';
export const initialTarget={accountId:'000000000000000000000001:team:000000000000000000000002',appId:'liara-copilot-test-20261022',projectId:'000000000000000000000003',currentRelease:null} as const;
export function allowedInitialTarget(target:{accountId:string;appId:string;projectId:string;currentRelease:string|null}){
 return target.accountId===initialTarget.accountId&&target.currentRelease===null&&(target.appId===initialTarget.appId?target.projectId===initialTarget.projectId:target.appId===NEW_TEST_APPLICATION_NAME&&/^[a-f0-9]{24}$/.test(target.projectId)&&target.projectId!==initialTarget.projectId);
}
export const initialDefinition={scope:{kind:'team',teamId:'000000000000000000000002'},networkId:'000000000000000000000004',plan:'small-g2',bundle:'basic',region:'iran',readOnlyRootFilesystem:true,expectedHTTP:[{path:'/',status:200},{path:'/health',status:200},{path:'/api/checkout',status:500}]} as const;
export type InitialEvidence={kind:'intentional-http500-baseline-v1';revision:string;smoke:CommandResult;regression:CommandResult;http:{path:string;status:number}[];diff:string};
