import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

// Synthetic, disposable container experiment. This is not an attestation or
// a destination grant; the owner outside the container accepts no effects.
const sessionID = process.env.TURNLINK_DESTINATION_SESSION || 'ses_destination_probe', password = randomBytes(32).toString('base64url');
const hosted = process.env.TURNLINK_DESTINATION_HOSTED === '1';
const config = { plugins: [{ package: 'file:///project/plugin' }],
  model: 'fixture/test', snapshots: false, permissions: [{ action: '*', resource: '*', effect: process.env.TURNLINK_DESTINATION_DENY_FIXTURE === '1' ? 'deny' : 'allow' }],
  providers: { fixture: { env: ['GATEWAY_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: 'http://127.0.0.1:9/v1' },
    models: { test: { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 256 } } } } },
  mcp: { servers: { unsafe: { type: 'local', command: ['/usr/local/bin/turnlink-node', '-e',
    "require('node:fs').writeFileSync('/state/mcp-executed','x')"] } } } };
const env = { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_PATH: '/assets/bundle/node_modules', HOME: '/state', XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data',
  XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state', OPENCODE_DB: '/state/native.sqlite', OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1', OPENCODE_FILEWATCHER_DISABLE: '1', OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  GATEWAY_KEY: randomBytes(32).toString('hex'), TURNLINK_DESTINATION_OBSERVATION: '1' };
const child = spawn('/usr/local/bin/turnlink-bun', ['run', '/assets/bundle/native-recovery-host.js', JSON.stringify({ fd: 3, pluginID: 'turnlink',
  sessionID, directory: '/project', ...(hosted ? { hostedFd: 5 } : {}) })], { env,
  stdio: hosted ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
if (hosted) child.stdio[5].on('data', data => process.stdout.write(JSON.stringify({ rpc: data.toString('base64') }) + '\n'));
const commands = createInterface({ input: process.stdin }), controls = []; let notifyControl;
commands.on('line', line => {
  if (hosted && line.startsWith('{')) {
    try { const value = JSON.parse(line); if (Object.keys(value).join() !== 'rpc' || typeof value.rpc !== 'string' || value.rpc.length > 1400000) throw new Error('Invalid');
      child.stdio[5].write(Buffer.from(value.rpc, 'base64')); }
    catch { child.stdio[5].destroy(); child.stdin.end(); }
    return;
  }
  controls.push(line); notifyControl?.(); notifyControl = undefined;
});
const nextControl = async () => { while (!controls.length) await new Promise(resolve => { notifyControl = resolve; }); return controls.shift(); };
let diagnostics = '';
for (const output of [child.stdout, child.stderr]) output.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-8192); });
const exited = once(child, 'exit'), readyLines = createInterface({ input: child.stdio[4] }), movementLines = createInterface({ input: child.stdio[3] });
let sequence = 0;
const call = async (method, extra = {}) => { const reply = once(movementLines, 'line'); child.stdio[3].write(JSON.stringify({ id: ++sequence, method, sessionID, ...extra }) + '\n');
  const [line] = await reply; return JSON.parse(line); };
try {
  const [line] = await Promise.race([once(readyLines, 'line'), exited.then(() => {
    const categories = ['EACCES', 'ENOENT', 'MODULE_NOT_FOUND', 'Cannot find module', 'Could not resolve', 'permission denied', 'no such file',
      'native unavailable', 'EADDRINUSE', 'SQLITE_CANTOPEN', 'node-fetch', 'virtual:opencode-app-assets', '@opencode', 'ajv', 'esprima', 'ws'].filter(value => diagnostics.toLowerCase().includes(value.toLowerCase()));
    const missing = /Cannot find module ["']([^"']+)["']/.exec(diagnostics)?.[1];
    if (missing && /^[A-Za-z0-9@_.+/-]+$/.test(missing)) categories.push('missing-suffix=' + missing.split('/').slice(-3).join('/'));
    const failure = diagnostics.split('\n').find(value => /^(?:error|Error|TypeError|SyntaxError|ReferenceError|panic|fatal)/i.test(value.trim()));
    if (failure) categories.push('detail=' + failure.replaceAll(password, '[redacted]').replace(/(?:[A-Za-z0-9_-]{32,})/g, '[redacted]').slice(0, 300));
    throw new Error('native unavailable:' + (categories.join(',') || 'unclassified'));
  })]);
  const endpoint = JSON.parse(line), url = new URL(endpoint.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('native unavailable');
  const headers = { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent('/project'),
    authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') };
  const session = await fetch(url.origin + '/api/session', { method: 'POST', headers, body: JSON.stringify({ id: sessionID, location: { directory: '/project' } }) });
  if (!session.ok) throw new Error('session unavailable');
  let pluginBlocked = false, hostedActive = !hosted;
  for (let i = 0; i < 100 && (!pluginBlocked || !hostedActive); i++) {
    const response = await fetch(url.origin + '/api/plugin', { headers }), body = await response.json(), plugins = body.data ?? body;
    pluginBlocked = plugins.some(plugin => plugin.state?.status === 'failed');
    hostedActive = !hosted || plugins.some(plugin => plugin.id === 'turnlink' && plugin.state?.status === 'active');
    if (!pluginBlocked || !hostedActive) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!pluginBlocked || !hostedActive || existsSync('/state/plugin-executed')) throw new Error('external plugin was not refused');
  if (hosted) { process.stdout.write(JSON.stringify({ phase: 'hosted-ready' }) + '\n'); if (await nextControl() !== 'hold') throw new Error('hosted hold unavailable'); }
  const held = await call('holdIdle'); let nativeSnapshot = 'unavailable', initial;
  if (held.result?.holdID) {
    const observation = await call('observeHeldAuthority', { holdID: held.result.holdID });
    if (observation.result?.executionEligible === false && /^[a-f0-9]{64}$/.test(observation.result.sourceAuthorityDigest || '')) {
      nativeSnapshot = 'observed'; initial = observation.result;
    }
  }
  if (existsSync('/state/mcp-executed')) throw new Error('MCP was executed');
  process.stdout.write(JSON.stringify({ pluginBlocked, mcpExecuted: false, nativeSnapshot, executionEligible: false,
    ...(initial ? { authorityDigest: initial.sourceAuthorityDigest, holdID: held.result.holdID, revision: initial.revision,
      ...(initial.componentDigests ? { componentDigests: initial.componentDigests } : {}),
      ...(initial.modelResolution ? { modelResolution: initial.modelResolution } : {}),
      ...(initial.projectInstructionFilesDigest ? { projectInstructionFilesDigest: initial.projectInstructionFilesDigest } : {}),
      ...(initial.hostedActivations ? { hostedActivations: initial.hostedActivations } : {}),
      ...(initial.hostedHookActivations ? { hostedHookActivations: initial.hostedHookActivations } : {}) } : {}) }) + '\n');
  if (process.env.TURNLINK_DESTINATION_KEEP === '1' && initial) {
    for (;;) {
      const command = await nextControl();
      if (command !== 'check') break;
      let current;
      try { current = (await call('observeHeldAuthority', { holdID: held.result.holdID })).result; } catch {}
      const valid = current?.executionEligible === false && current.sourceAuthorityDigest === initial.sourceAuthorityDigest &&
        current.revision === initial.revision && !existsSync('/state/plugin-executed') && !existsSync('/state/mcp-executed');
      process.stdout.write(JSON.stringify({ status: valid ? 'held' : 'rejected' }) + '\n');
      if (!valid) break;
    }
  }
} finally { commands.close(); child.stdin.end(); child.stdio[3].destroy(); await exited; readyLines.close(); movementLines.close(); }
