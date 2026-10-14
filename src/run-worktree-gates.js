import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = ['codex-worktree-gate.test.js', 'opencode-service.test.js'].map(name => fileURLToPath(new URL(`../test/${name}`, import.meta.url)));
const child = spawn(process.execPath, ['--test', ...tests], { stdio: 'inherit', env: { ...process.env,
  TURNLINK_CODEX_INTEGRATION: '1', TURNLINK_OPENCODE_INTEGRATION: '1' } });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
