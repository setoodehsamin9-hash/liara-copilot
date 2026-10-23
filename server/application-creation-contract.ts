import {z} from 'zod';

// Public examples use synthetic account/resource IDs. These are not live targets.
// Two exact test names; the independent name is team/network restricted by the adapter.
export const TEST_APPLICATION_ACCOUNT='000000000000000000000001';
export const TEST_APPLICATION_NAME='liara-copilot-test-20261022';
export const NEW_TEST_APPLICATION_NAME='liara-copilot-checkout-20261023';
export const ORIGINAL_TEST_APPLICATION_ID='000000000000000000000003';
export const TestApplicationName=z.enum([TEST_APPLICATION_NAME,NEW_TEST_APPLICATION_NAME]);
export type TestApplicationName=z.infer<typeof TestApplicationName>;
export const TEST_APPLICATION_NETWORK='000000000000000000000005';
export const ApplicationCreationInput=z.object({name:TestApplicationName,networkId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)}).strict();
export const applicationCreationBody=(network=TEST_APPLICATION_NETWORK,name:TestApplicationName=TEST_APPLICATION_NAME)=>({name,platform:'node' as const,planID:'small-g2',bundlePlanID:'basic',network,readOnlyRootFilesystem:true});
const Id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
// Public OpenAPI identity fields plus official CLI-observed network/bundle/read-only fields.
export const CreationProject=z.object({_id:Id,project_id:Id,type:z.string().max(100),planID:Id,bundlePlanID:Id,network:z.object({_id:Id,name:z.string().max(200)}),readOnlyRootFilesystem:z.boolean()});
export type CreationProject=z.infer<typeof CreationProject>;
export type CreationCost={finalKnown:false;hourlyPriceRaw:number;monthlyHardwareFromCLI:number;baseBundleDisplayPrice:number;ramGB:number;cpuCores:number;diskGB:number};
export type CreationEvidence={endpoint:'/v1/me'|'/v1/networks'|'/v1/projects'|`/v1/projects/${TestApplicationName}`;fetchedAt:string};
export type CreationState='pending'|'dispatched'|'confirmed'|'existing'|'uncertain'|'failed'|'invalidated'|'rejected'|'expired';
export type CreationReason='awaiting_approval'|'already_exists'|'verified'|'read_unavailable'|'not_found'|'present_unattributed'|'configuration_mismatch'|'identity_changed'|'request_rejected'|'precondition_changed'|'restart'|'rejected'|'expired';
export type ApplicationCreationView={id:string;accountId:string;state:CreationState;reason:CreationReason;attempts:number;grantID:string;digest:string;expires:number;reviewNonce:string;applicationId?:string;postStatus?:number;verifiedAt?:string;configurationVerified:boolean;evidence:CreationEvidence[];cost:CreationCost;region:'iran';impact:string;action:{method:'POST';path:'/v1/projects';body:ReturnType<typeof applicationCreationBody>}};
