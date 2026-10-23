import type {Store} from './store.js';

/** Called inside the same SQLite write transaction as proposal/dispatch. No external lock service. */
export function hasCloudTargetConflict(store:Store,account:string,target:string,ownCreation?:string,now=Date.now()){
 const exists=(table:string)=>!!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
 if(exists('application_creations'))store.db.prepare("UPDATE application_creations SET state='expired',reason='expired' WHERE state='pending' AND expires<=?").run(now);
 if(exists('operations')&&store.db.prepare("SELECT 1 FROM operations WHERE account=? AND target=? AND state IN ('pending','running','uncertain')").get(account,target))return true;
 return exists('application_creations')&&!!store.db.prepare("SELECT 1 FROM application_creations WHERE account=? AND target=? AND id<>? AND state IN ('pending','dispatched','uncertain')").get(account,target,ownCreation??'');
}
