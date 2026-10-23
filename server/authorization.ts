import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';

export const CloudAction = z.object({
  kind: z.enum(['deploy', 'restart', 'rollback', 'scale', 'environment_change', 'resource_create', 'resource_delete']),
  accountId: z.string().min(1).max(200), targetId: z.string().min(1).max(200),
  revision: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.json()),
}).strict();
export type CloudAction = z.infer<typeof CloudAction>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function actionDigest(action: CloudAction) {
  return createHash('sha256').update(canonical(CloudAction.parse(action))).digest('hex');
}

/** Human-operation gate, used by the Phase 4 reviewed deployment boundary.
 * principal MUST be issued by trusted server session middleware, never by model input.
 * All grants are invalidated with a fresh gate instance (including process restart).
 */
export class ApprovalGate {
  private readonly instanceId = randomUUID();
  constructor(private store: Store, private now = Date.now) {}
  private principal(principal: string) { return `${this.instanceId}:${principal}`; }
  prepare(action: CloudAction, principal: string) {
    const proposal = { id: randomUUID(), digest: actionDigest(action), expires: this.now() + 5 * 60_000 };
    this.store.db.prepare('INSERT INTO approvals(id,digest,principal,expires,state) VALUES (?,?,?,?,?)').run(proposal.id, proposal.digest, this.principal(principal), proposal.expires, 'pending');
    this.store.audit('approval_prepared');
    return proposal;
  }
  confirm(id: string, digest: string, principal: string) {
    const result = this.store.db.prepare("UPDATE approvals SET state='approved' WHERE id=? AND digest=? AND principal=? AND state='pending' AND expires>?").run(id, digest, this.principal(principal), this.now());
    if (result.changes !== 1) throw new Error('Approval denied');
    this.store.audit('approval_confirmed');
  }
  consume(id: string, action: CloudAction, principal: string) {
    const result = this.store.db.prepare("UPDATE approvals SET state='consumed' WHERE id=? AND digest=? AND principal=? AND state='approved' AND expires>?").run(id, actionDigest(action), this.principal(principal), this.now());
    if (result.changes !== 1) throw new Error('Approval denied');
    this.store.audit('approval_consumed');
    // Consumption is durable BEFORE any external call. Retry requires fresh approval.
  }
  reject(id:string,digest:string,principal:string){
    const result=this.store.db.prepare("UPDATE approvals SET state='consumed' WHERE id=? AND digest=? AND principal=? AND state IN ('pending','approved')").run(id,digest,this.principal(principal));
    if(result.changes!==1)throw new Error('Approval denied');this.store.audit('approval_rejected');
  }
}

export function assertReadOnlyCapability(capability: 'chat' | 'diagnostics' | 'source_write' | 'cloud_mutation') {
  if (capability !== 'chat' && capability !== 'diagnostics') throw new Error('This capability is not enabled in Phase 2');
}
