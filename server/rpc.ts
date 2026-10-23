import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { RpcMessage } from './protocol.js';

export class RpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class CodexRpc extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = '';
  private requestHandler?: (method:string,params:Record<string,unknown>)=>Promise<unknown>;
  setRequestHandler(handler:(method:string,params:Record<string,unknown>)=>Promise<unknown>){this.requestHandler=handler;}

  start(executable: string, cwd: string, modelCatalog?:string) {
    if (this.child) throw new Error('Already started');
    // Do not inherit desktop pipes, session identity, cloud secrets, or API keys.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CODEX_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const disabled = ['shell_tool', 'plugins', 'remote_plugin', 'apps', 'hooks', 'multi_agent', 'goals', 'computer_use', 'browser_use', 'image_generation', 'view_image', 'skill_search', 'tool_suggest', 'workspace_dependencies', 'memories'];
    const args = ['app-server', '--listen', 'stdio://', ...disabled.flatMap(name => ['-c', `features.${name}=false`]), '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"', '-c', 'shell_environment_policy.inherit="none"'];
    if(modelCatalog)args.push('-c',`model_catalog_json=${JSON.stringify(modelCatalog)}`);
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 2_000_000) { this.fail(new RpcError('protocol_error', 'Runtime output exceeded limit')); return; }
      let pos: number;
      while ((pos = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, pos); this.buffer = this.buffer.slice(pos + 1);
        if (!line.trim()) continue;
        try {
          const msg = RpcMessage.parse(JSON.parse(line));
          if (msg.method && msg.id !== undefined) {
            if(this.requestHandler){
              const id=msg.id,method=msg.method;
              void this.requestHandler(method,msg.params??{}).then(result=>{if(this.child===child)this.send({id,result});}).catch(()=>{
                if(this.child===child)this.send({id,error:{code:-32601,message:'Client operation denied'}});
                this.emit('requestDenied',method);
              });
              continue;
            }
            // No runtime approval or tool invocation can be granted in Phase 1.
            this.send({ id: msg.id, error: { code: -32601, message: 'Client execution and approval are disabled in Phase 1' } });
            this.emit('requestDenied', msg.method);
          } else if (msg.id !== undefined) {
            const pending = this.pending.get(Number(msg.id));
            if (pending) {
              clearTimeout(pending.timer); this.pending.delete(Number(msg.id));
              if (msg.error) pending.reject(new RpcError('rpc_error', msg.error.message));
              else pending.resolve(msg.result);
            }
          } else if (msg.method) this.emit('notification', msg.method, msg.params ?? {});
        } catch { this.fail(new RpcError('protocol_error', 'Invalid runtime protocol message')); return; }
      }
    });
    // Drain stderr, but never forward potentially sensitive runtime output to browsers/logs.
    child.stderr.resume();
    child.on('error', () => this.fail(new RpcError('runtime_missing', 'Codex executable could not be started')));
    child.on('exit', () => this.fail(new RpcError('disconnected', 'Codex process exited')));
    child.stdin.on('error', () => this.fail(new RpcError('disconnected', 'Codex input closed')));
  }

  private send(value: unknown) {
    if (!this.child || this.child.stdin.destroyed) throw new RpcError('disconnected', 'Codex is disconnected');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }

  notify(method: string, params: unknown) { this.send({ method, params }); }

  request(method: string, params: unknown, timeout = 30_000): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new RpcError('timeout', `Codex request timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  private fail(error: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('disconnect', error);
    this.close();
  }

  close() {
    const child = this.child; this.child = undefined;
    child?.stdin.end(); child?.kill();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new RpcError('disconnected', 'Codex stopped')); }
    this.pending.clear(); this.buffer = '';
  }
}
