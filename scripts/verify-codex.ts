import { resolve } from 'node:path';
import { CodexRuntime } from '../server/codex.js';
import {codexExecutable} from '../server/codex-binary.js';
import { Store } from '../server/store.js';
import type { ChatEvent } from '../server/protocol.js';

const store = new Store(':memory:');
const runtime = new CodexRuntime({ executable: codexExecutable(), cwd: resolve('.local/codex-workspace'), store });
try {
  console.log('Connection:', await runtime.connect());
  if (runtime.status.state !== 'ready') throw new Error('Codex not ready');
  const events: ChatEvent[] = [];
  await runtime.chat('This is a harmless connectivity test. Do not use tools, read files, or change anything. Reply with exactly: LIARA_CODEX_OK', event => { events.push(event); console.log(JSON.stringify(event)); });
  const answer = events.filter(e => e.type === 'message').map(e => e.text).join('');
  if (!events.some(e => e.type === 'done' && e.status === 'completed') || !answer.includes('LIARA_CODEX_OK')) throw new Error('No verified real answer');
  console.log('VERIFIED: real Codex completed a harmless conversation.');
} finally { runtime.close(); store.close(); }
