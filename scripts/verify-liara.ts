import { LiaraObservability, LiaraError } from '../server/liara.js';

const liara = new LiaraObservability(process.env.LIARA_API_TOKEN);
delete process.env.LIARA_API_TOKEN;
if (!liara.status().configured) {
  console.log('UNVERIFIED: no backend Liara credential configured; no authenticated cloud request attempted.');
  process.exitCode = 2;
} else {
  try {
    const status = await liara.connect();
    console.log(JSON.stringify({ verification: 'LIVE', state: status.state, verifiedAt: status.verifiedAt, applications: liara.apps().data.length }));
    const appId = process.argv[2];
    if (appId) {
      liara.select(appId); const snapshot = await liara.refresh();
      const sections = Object.fromEntries(['details','logs','cpu','memory','releases'].map(key => [key, snapshot[key as 'details'].state]));
      console.log(JSON.stringify({ verification: 'LIVE', fetchedAt: snapshot.fetchedAt, sections }));
      if (Object.values(sections).some(state => state === 'error')) process.exitCode = 1;
    } else console.log('App-specific live checks NOT RUN: pass an authorized listed app name to this script.');
  } catch (error) {
    console.log(JSON.stringify({ verification: 'LIVE_FAILED', code: error instanceof LiaraError ? error.code : 'request_failed' }));
    process.exitCode = 1;
  } finally { liara.disconnect(); }
}
