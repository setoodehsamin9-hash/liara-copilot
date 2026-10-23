// A read-only allowlist for an optional, separately installed official CLI.
// These are synthetic, public example targets; never a real account.
export const cliReadLimit = 1024 * 1024;
const team = '000000000000000000000002';
const applications = new Set(['liara-copilot-test-20261022', 'liara-copilot-checkout-20261023']);

export function assertCliRead(method, url, count) {
  if (method !== 'GET' || !Number.isInteger(count) || count < 0 || count >= 20 ||
      url.protocol !== 'https:' || url.host !== 'api.liara.ir' || url.username || url.password || url.hash) {
    throw new Error('CLI read denied');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const identity = url.pathname === '/v1/me';
  const catalog = ['/v2/teams', '/v1/projects'].includes(url.pathname);
  const project = parts[0] === 'v1' && parts[1] === 'projects' && applications.has(parts[2]) &&
    (parts.length === 3 || (parts.length === 4 && parts[3] === 'releases'));
  if (!identity && !catalog && !project) throw new Error('CLI read denied');
  const selected = url.searchParams.get('teamID');
  if (selected !== team && !(identity && selected === '')) throw new Error('CLI scope denied');
  if (url.searchParams.getAll('teamID').length !== 1) throw new Error('CLI scope denied');
  for (const key of url.searchParams.keys()) {
    if (key !== 'teamID' && !(project && parts[3] === 'releases' && ['page', 'count'].includes(key))) throw new Error('CLI query denied');
  }
  if (url.searchParams.has('page') && url.searchParams.get('page') !== '1') throw new Error('CLI pagination denied');
  if (url.searchParams.has('count') && url.searchParams.get('count') !== '10') throw new Error('CLI pagination denied');
}

// Got invokes handlers before buffering a response. Cancel as soon as a known
// length or the observed download crosses the bound; never log upstream data.
export function limitCliDownload(options, next) {
  const request = next(options);
  request.on('response', response => {
    const length = Number(response.headers['content-length']);
    if (Number.isFinite(length) && length > cliReadLimit) request.cancel();
  });
  request.on('downloadProgress', progress => {
    if (progress.transferred > cliReadLimit) request.cancel();
  });
  return request;
}
