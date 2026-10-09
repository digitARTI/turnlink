import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const executable = process.env.AGENT_CHANNEL_CODEX_EXECUTABLE || 'codex';
const child = spawn(process.execPath, [fileURLToPath(new URL('./codex-proxy.js', import.meta.url)), 'app-server'], {
  env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: executable }, stdio: ['pipe', 'pipe', 'pipe'],
});
let done = false;
const timeout = setTimeout(() => { console.error('FAIL: Codex app-server initialization timed out'); process.exitCode = 1; child.kill(); }, 10000);
child.stderr.on('data', data => process.stderr.write(data));
child.on('error', error => { console.error(error.message); process.exitCode = 1; clearTimeout(timeout); });
createInterface({ input: child.stdout }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id !== 'doctor-init') return;
  done = true; clearTimeout(timeout);
  if (message.error) { console.error(`FAIL: ${JSON.stringify(message.error)}`); process.exitCode = 1; }
  else console.log(`PASS: Real Codex app-server initialized through proxy: ${JSON.stringify(message.result)}`);
  child.stdin.end();
});
child.on('exit', () => { clearTimeout(timeout); if (!done) process.exitCode = 1; });
child.stdin.write(`${JSON.stringify({ id: 'doctor-init', method: 'initialize', params: {
  clientInfo: { name: 'agent_channel_doctor', version: '0.1.0' },
} })}\n`);
