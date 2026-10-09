import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
if (args.some(a => ['--session-id', '--resume', '--continue', '-r', '-c'].some(flag => a === flag || a.startsWith(`${flag}=`)))) {
  throw new Error('For resume, use the real existing session ID and set AGENT_CHANNEL_SESSION_ID explicitly; this launcher starts a fresh bound session');
}
const sessionId = randomUUID();
const child = spawn('claude', ['--session-id', sessionId, ...args], {
  stdio: 'inherit', env: { ...process.env, AGENT_CHANNEL_SESSION_ID: sessionId },
});
child.on('error', () => { console.error('Claude executable unavailable'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
