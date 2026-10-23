// Explicit diagnostic entrypoint. Never imports the optional CLI or performs a
// network request until input is valid. Never prints a credential or exception.
const token = process.env.LIARA_CLI_PREFLIGHT_TOKEN ?? '';
delete process.env.LIARA_CLI_PREFLIGHT_TOKEN;
const incomplete = () => {
  process.stdout.write(JSON.stringify({ state: 'read_only_preflight_incomplete', cloudMutations: 0 }) + '\n');
  process.exitCode = 1;
};
if (!/^[\x21-\x7e]{16,8192}$/.test(token) || /^Bearer\s/i.test(token) || /^["']|["']$/.test(token)) {
  incomplete();
} else {
  try {
    const { diagnoseLiaraAuth } = await import('../dist-server/server/liara-auth-diagnostics.js');
    const result = await diagnoseLiaraAuth(token);
    process.stdout.write(JSON.stringify({ state: 'read_only_preflight_complete', cloudMutations: 0, ...result }) + '\n');
  } catch { incomplete(); }
}
