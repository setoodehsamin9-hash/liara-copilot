import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, digest TEXT NOT NULL, principal TEXT NOT NULL,
        expires INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','approved','consumed'))
      );`);
  }
  audit(event: 'runtime_ready' | 'runtime_disconnected' | 'turn_started' | 'turn_completed' | 'turn_failed' | 'approval_prepared' | 'approval_confirmed' | 'approval_consumed' | 'approval_rejected') {
    // Never persist prompts, source, tokens, tool output, or raw runtime errors.
    this.db.prepare('INSERT INTO audit(at,event) VALUES (?,?)').run(new Date().toISOString(), event);
  }
  close() { this.db.close(); }
}
