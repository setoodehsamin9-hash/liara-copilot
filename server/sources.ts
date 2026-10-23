import { randomUUID } from 'node:crypto';
import { lstat, realpath, open } from 'node:fs/promises';
import { isAbsolute, resolve, relative, parse, join, basename } from 'node:path';
import { z } from 'zod';
import { redactSecrets } from './liara.js';
import type { AppScope, SourceAssociation, SourceCandidate } from './source-types.js';

const errors: Record<string,string> = {
  invalid_source: 'پروژه باید از مسیرهای مجازِ تنظیم‌شده در راه‌انداز انتخاب شود.',
  unsafe_path: 'مسیر پیوندی یا خارج از محدودهٔ مجاز است؛ اتصال انجام نشد.',
  unsupported_git: 'این ساختار Git در این مرحله پشتیبانی نمی‌شود؛ فقط پوشهٔ مستقل با فرادادهٔ محلی مجاز است.',
  invalid_git: 'فرادادهٔ Git معتبر یا قابل خواندن نیست.',
  github_unavailable: 'فرادادهٔ مخزن GitHub دریافت نشد؛ نام، دسترسی و اتصال را بررسی کنید.',
  github_auth: 'دسترسی به این مخزن نیاز به اعتبارنامهٔ معتبرِ سمت سرور دارد.',
};
export class SourceError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) { super(errors[code] ?? errors.invalid_source); }
}
export const GitHubOwner = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
export const GitHubRepo = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).refine(value => value !== '.' && value !== '..');
const revision = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const comparePath = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);

/** No Git subprocess: includes, hooks, helpers, fsmonitor and lazy fetch cannot run. */
export async function safePath(target: string, root: string) {
  const rel = relative(root,target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new SourceError('unsafe_path');
  let current = parse(target).root;
  for (const segment of relative(current,target).split(/[\\/]/).filter(Boolean)) {
    current = join(current,segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new SourceError('unsafe_path');
  }
  if (comparePath(await realpath(target)) !== comparePath(target)) throw new SourceError('unsafe_path');
  return lstat(target);
}
async function exists(path: string) { try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function boundedMetadata(path: string, root: string, limit: number) {
  const before = await safePath(path,root);
  if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw new SourceError('invalid_git');
  const handle = await open(path,'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > limit) throw new SourceError('unsafe_path');
    await safePath(path,root);
    const buffer = Buffer.alloc(limit+1); const result = await handle.read(buffer,0,limit+1,0);
    if (result.bytesRead > limit) throw new SourceError('invalid_git');
    await safePath(path,root);
    return buffer.subarray(0,result.bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
async function localMetadata(root: string): Promise<Omit<SourceAssociation,'fetchedAt'>> {
  try {
    if (!(await safePath(root,root)).isDirectory()) throw new SourceError('invalid_source');
    const git = join(root,'.git');
    if (!(await safePath(git,root)).isDirectory()) throw new SourceError('unsupported_git');
    // Reject indirections before following any repository-supplied path.
    if (await exists(join(git,'commondir')) || await exists(join(git,'objects','info','alternates'))) throw new SourceError('unsupported_git');
    const head = (await boundedMetadata(join(git,'HEAD'),root,512)).trim();
    let sha: string | null = null; let branch: string | null = null;
    if (revision.test(head)) sha = head.toLowerCase();
    else {
      const match = /^ref: (refs\/heads\/[A-Za-z0-9._/-]{1,200})$/.exec(head);
      if (!match || match[1]!.split('/').some(part => !part || part === '.' || part === '..')) throw new SourceError('invalid_git');
      const ref = match[1]!; branch = ref.slice('refs/heads/'.length);
      const loose = join(git,...ref.split('/'));
      if (await exists(loose)) {
        const content = (await boundedMetadata(loose,root,128)).trim();
        if (!revision.test(content)) throw new SourceError('invalid_git'); sha = content.toLowerCase();
      } else if (await exists(join(git,'packed-refs'))) {
        const packed = await boundedMetadata(join(git,'packed-refs'),root,1_048_576);
        for (const line of packed.split(/\r?\n/)) {
          const [value,name] = line.split(' ');
          if (name === ref) { if (!value || !revision.test(value)) throw new SourceError('invalid_git'); sha = value.toLowerCase(); }
        }
      }
    }
    return { kind:'local',label:basename(root),revision:sha,branch,access:'metadata-only' };
  } catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('invalid_git'); }
}

export class SourceRegistry {
  #roots = new Map<string,string>();
  #githubToken?: string;
  #fetch: typeof fetch;
  #redactor:(text:string)=>string;
  private associations = new Map<string,{ data: SourceAssociation; candidateId?: string }>();
  constructor(options: { roots?: string[]; githubToken?: string; fetch?: typeof fetch;redact?:(text:string)=>string } = {}) {
    this.#fetch = options.fetch ?? fetch; this.#githubToken = options.githubToken;
    this.#redactor=options.redact??(value=>value);
    for (const root of z.array(z.string().min(1).max(1000)).max(8).parse(options.roots ?? [])) {
      if (!isAbsolute(root) || /^(?:\\\\|\/\/)/.test(root) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(root)) throw new SourceError('unsafe_path');
      this.#roots.set(randomUUID(),resolve(root));
    }
  }
  private key(scope: AppScope) { return JSON.stringify([scope.accountId,scope.appId]); }
  private clean(value: string) { return this.#redactor(redactSecrets(value,this.#githubToken ? [this.#githubToken] : [])); }
  sanitize(value:string){return this.clean(value);}
  async candidates(): Promise<SourceCandidate[]> { return [...this.#roots].map(([id,root])=>({id,label:this.clean(basename(root))})); }
  async associateLocal(scope: AppScope, id: string) {
    const root = this.#roots.get(id); if (!root) throw new SourceError('invalid_source');
    const metadata = await localMetadata(root);
    const data: SourceAssociation = { ...metadata,label:this.clean(metadata.label),branch:metadata.branch ? this.clean(metadata.branch) : null,fetchedAt:new Date().toISOString() };
    this.associations.set(this.key(scope),{ data,candidateId:id }); return data;
  }
  private async github(path: string): Promise<unknown> {
    try {
      const response = await this.#fetch(`https://api.github.com${path}`, { method:'GET',redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'liara-copilot',...(this.#githubToken ? {Authorization:`Bearer ${this.#githubToken}`} : {})} });
      if (!response.ok) { await response.body?.cancel().catch(()=>{}); throw new SourceError(response.status === 401 || response.status === 403 || response.status === 404 ? 'github_auth' : 'github_unavailable',502); }
      if (!response.body) throw new SourceError('github_unavailable',502);
      const reader = response.body.getReader(); let size=0; const chunks: Uint8Array[]=[];
      try { while (true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>524288){await reader.cancel();throw new SourceError('github_unavailable',502);}chunks.push(value); } } finally {reader.releaseLock();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch(error) { if(error instanceof SourceError) throw error; throw new SourceError('github_unavailable',502); }
  }
  async associateGitHub(scope: AppScope, owner: string, repo: string) {
    if (!GitHubOwner.safeParse(owner).success || !GitHubRepo.safeParse(repo).success) throw new SourceError('invalid_source');
    const prefix=`/repos/${owner}/${repo}`;
    try {
      const metadata=z.object({full_name:z.string().max(200),default_branch:z.string().min(1).max(200)}).parse(await this.github(prefix));
      if(metadata.full_name.toLowerCase()!==`${owner}/${repo}`.toLowerCase())throw new SourceError('github_unavailable',502);
      const branch=z.object({commit:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/i)})}).parse(await this.github(`${prefix}/branches/${encodeURIComponent(metadata.default_branch)}`));
      const data: SourceAssociation={kind:'github',label:this.clean(metadata.full_name),revision:branch.commit.sha.toLowerCase(),branch:this.clean(metadata.default_branch),fetchedAt:new Date().toISOString(),access:'metadata-only'};
      this.associations.set(this.key(scope),{data});return data;
    } catch(error){if(error instanceof SourceError)throw error;throw new SourceError('github_unavailable',502);}
  }
  async get(scope: AppScope): Promise<SourceAssociation|null> {
    const saved=this.associations.get(this.key(scope));if(!saved)return null;
    if(saved.candidateId){
      const root=this.#roots.get(saved.candidateId);if(!root)throw new SourceError('invalid_source');
      const metadata=await localMetadata(root);
      if(this.associations.get(this.key(scope))!==saved)return null;
      return {...metadata,label:this.clean(metadata.label),branch:metadata.branch?this.clean(metadata.branch):null,fetchedAt:new Date().toISOString()};
    }
    return {...saved.data};
  }
  disconnect(scope: AppScope){this.associations.delete(this.key(scope));}
  async capture(scope:AppScope):Promise<Record<string,string>>{
    const saved=this.associations.get(this.key(scope));if(!saved)throw new SourceError('invalid_source',409);
    const {captureSource,allowedSource}=await import('./repair-files.js');
    let files:Record<string,string>;
    if(saved.candidateId){
      const root=this.#roots.get(saved.candidateId);if(!root)throw new SourceError('invalid_source');
      await localMetadata(root);files=await captureSource(root,value=>this.clean(value));
    }else{
      const [owner,repo]=saved.data.label.split('/');if(!owner||!repo||!saved.data.revision)throw new SourceError('invalid_source');
      const prefix=`/repos/${owner}/${repo}/git`;
      const commit=z.object({sha:z.string(),tree:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/i)})}).parse(await this.github(`${prefix}/commits/${saved.data.revision}`));
      if(commit.sha!==saved.data.revision)throw new SourceError('invalid_source');
      const tree=z.object({truncated:z.boolean(),tree:z.array(z.object({path:z.string().max(240),type:z.string(),mode:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/i),size:z.number().optional()})).max(2000)}).parse(await this.github(`${prefix}/trees/${commit.tree.sha}?recursive=1`));
      if(tree.truncated)throw new SourceError('invalid_source');files=Object.create(null) as Record<string,string>;let bytes=0;
      for(const entry of tree.tree){
        if(!allowedSource(entry.path))continue;if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||entry.size===undefined||entry.size>131072)throw new SourceError('unsafe_path');
        const blob=z.object({sha:z.string(),encoding:z.literal('base64'),content:z.string().max(200000),size:z.number().max(131072)}).parse(await this.github(`${prefix}/blobs/${entry.sha}`));
        const buffer=Buffer.from(blob.content,'base64'),content=buffer.toString('utf8');
        if(blob.sha!==entry.sha||buffer.length!==blob.size||Buffer.byteLength(content)!==buffer.length||content.includes('\0'))throw new SourceError('invalid_source');
        if(this.clean(content)!==content)continue;bytes+=buffer.length;
        if(Object.keys(files).length>=200||bytes>2097152)throw new SourceError('invalid_source');files[entry.path]=content;
      }
    }
    if(this.associations.get(this.key(scope))!==saved)throw new SourceError('invalid_source',409);
    return files;
  }
}
