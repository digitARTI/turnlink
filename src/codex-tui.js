#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createCodexTuiBridge } from './codex-tui-bridge.js';
import { resolveExecutable } from './executable.js';

const args = process.argv.slice(2);
if (args.some(value => value === '--remote' || value.startsWith('--remote=') || value === '--remote-auth-token-env' || value.startsWith('--remote-auth-token-env='))) {
  console.error('Turnlink: the remote connection is managed by this launcher.'); process.exit(2);
}
let executable;
try { executable = resolveExecutable(process.env.AGENT_CHANNEL_CODEX_EXECUTABLE || ''); }
catch { console.error('Turnlink: set AGENT_CHANNEL_CODEX_EXECUTABLE to the official Codex executable.'); process.exit(2); }
const bridge = await createCodexTuiBridge();
const tuiArgs = ['--remote', bridge.url, '--remote-auth-token-env', 'TURNLINK_TUI_CAPABILITY', ...args];
const tui = spawn(executable, tuiArgs, { env: { ...process.env, TURNLINK_TUI_CAPABILITY: bridge.secret }, stdio: 'inherit' });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
  if (!stopping) { stopping = true; tui.kill(signal); }
});
const result = await new Promise(resolve => {
  tui.once('error', () => resolve({ code: 1 }));
  tui.once('exit', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0) }));
});
await bridge.close();
process.exitCode = result.code;
