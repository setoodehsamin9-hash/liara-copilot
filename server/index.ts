import { resolve } from 'node:path';
import { createApp } from './app.js';
import { CodexRuntime } from './codex.js';
import {codexExecutable} from './codex-binary.js';
import { Store } from './store.js';
import { LiaraObservability } from './liara.js';
import { SourceRegistry } from './sources.js';
import {LiaraDeployment} from './deployment.js';
import {Operations} from './operations.js';
import {LiaraNetworks,NetworkOperations} from './networks.js';
import {ApplicationCreations,LiaraApplicationCreation} from './application-creations.js';
import {scopeSelector} from './scoped-services.js';

const port = Number(process.env.LIARA_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LIARA_PORT');
const origin = `http://127.0.0.1:${port}`;
const store = new Store(resolve('.local/liara.sqlite'));
const runtime = new CodexRuntime({ executable: codexExecutable(), cwd: resolve('.local/codex-workspace'), store });
const liara = new LiaraObservability(process.env.LIARA_API_TOKEN);
const deployment=new LiaraDeployment({token:process.env.LIARA_API_TOKEN,healthOrigin:process.env.LIARA_DEPLOY_HEALTH_ORIGIN,healthAppId:process.env.LIARA_DEPLOY_HEALTH_APP});
const liveDeploymentEnabled=process.env.LIARA_ENABLE_DEPLOYMENT==='1'&&!!process.env.LIARA_API_TOKEN;
const networks=process.env.LIARA_API_TOKEN?new NetworkOperations(store,new LiaraNetworks({token:process.env.LIARA_API_TOKEN})):undefined;
const applicationCreations=process.env.LIARA_API_TOKEN?new ApplicationCreations(store,new LiaraApplicationCreation({token:process.env.LIARA_API_TOKEN})):undefined;
const selectScope=scopeSelector(process.env.LIARA_API_TOKEN,store,undefined,{healthOrigin:process.env.LIARA_DEPLOY_HEALTH_ORIGIN,healthAppId:process.env.LIARA_DEPLOY_HEALTH_APP});
// Retain only the private client closure. Codex's environment whitelist also excludes it.
delete process.env.LIARA_API_TOKEN;
const sources = new SourceRegistry({roots:process.env.LIARA_SOURCE_ROOTS ? JSON.parse(process.env.LIARA_SOURCE_ROOTS) as string[] : [],githubToken:process.env.LIARA_GITHUB_TOKEN,redact:text=>liara.redact(text)});
delete process.env.LIARA_GITHUB_TOKEN;
delete process.env.LIARA_SOURCE_ROOTS;
const app = createApp(runtime, origin, liara, sources,{deployment,operations:new Operations(store),liveDeploymentEnabled,networks,applicationCreations,selectScope});
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false } });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    reply.hijack();
    vite.middlewares(req.raw, reply.raw, () => { reply.raw.statusCode = 404; reply.raw.end('Not found'); });
  });
  app.addHook('onClose', async () => vite.close());
} else {
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, { root: resolve('dist'), index: ['index.html'], dotfiles: 'deny' });
}
await app.listen({ port, host: '127.0.0.1' });
console.log(`Liara Copilot: ${origin} (Phase 5; durable recovery; live deployment ${liveDeploymentEnabled?'requires exact human approval':'disabled'})`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return; stopping = true;
  runtime.close();
  void app.close().finally(() => { store.close(); });
});
