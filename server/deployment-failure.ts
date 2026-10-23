import {z} from 'zod';
/** No free text, headers, URLs, response bodies or exception messages cross this seam. */
const Diagnostic=z.object({
 version:z.literal(1),phase:z.enum(['read','upload','release']),
 category:z.enum(['timeout','network','http','invalid_json','empty_response','response_limit','invalid_receipt']),
 status:z.number().int().min(100).max(599).optional(),
 timeoutMs:z.number().int().min(1).max(120000),elapsedMs:z.number().int().min(0).max(3600000),
});
export type DeploymentDiagnostic=z.infer<typeof Diagnostic>;
export function safeDeploymentDiagnostic(value:unknown):DeploymentDiagnostic|undefined{
 const result=Diagnostic.safeParse(value);return result.success?result.data:undefined;
}
