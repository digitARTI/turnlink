import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { ChannelClient } from '../src/client.js';
import { startDeepSeekTestGateway } from '../src/opencode-deepseek-gateway.js';

test('ordinary broker startup keeps contained-host recovery disabled by default', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'tl-default-')), probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const proc = spawn(process.execPath, ['src/broker.js'], { stdio: ['ignore', 'ignore', 'pipe'], env: {
    PATH: process.env.PATH, AGENT_CHANNEL_STATE_DIR: root, AGENT_CHANNEL_URL: `ws://127.0.0.1:${port}`, AGENT_CHANNEL_TOKEN: '1'.repeat(64) } });
  let errors = ''; proc.stderr.on('data', chunk => { errors += chunk; }); const exited = once(proc, 'exit');
  t.after(async () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM'); await exited; rmSync(root, { recursive: true, force: true }); });
  const deadline = Date.now() + 5000;
  while (!errors.includes('listening on') && proc.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(errors, /listening on/);
  const client = new ChannelClient({ url: `ws://127.0.0.1:${port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') });
  try { assert.deepEqual(await client.request('control_info'), { version: 1, enabled: false, effectsEnabled: false }); }
  finally { client.close(); }
});

test('opt-in contained-host CLI starts a broker and routes a VM guest message',
  { skip: process.env.OPENCODE_CONTAINED_HOST_CLI_TEST !== '1' || process.platform !== 'darwin', timeout: 120000 }, async t => {
    const manifestPath = process.env.TURNLINK_RUNTIME_MANIFEST, manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const root = mkdtempSync('/private/tmp/tl-cli-'), docker = '/opt/homebrew/bin/docker';
    const dir = name => { const value = join(root, name); mkdirSync(value, { mode: 0o700 }); return value; };
    const token = (name, value) => { const file = join(root, name); writeFileSync(file, value.repeat(64), { mode: 0o600 }); return file; };
    const config = { version: 1, docker, runtimeManifest: manifestPath,
      owner: { directory: dir('owner'), spec: { resourceID: randomUUID(), image: manifest.image, command: ['-e', 'setInterval(()=>{},1000)'],
        mounts: [], init: true, volume: { destination: '/var/lib/turnlink', mode: 'rw' }, tmpfs: ['/tmp', '/run/turnlink-secrets'] } },
      broker: { directory: dir('broker'), endpointDirectory: dir('endpoints'), verifierDirectory: dir('verifiers'), port: 0,
        hostTokenFile: token('host-token', '1'), adminTokenFile: token('admin-token', '2'), completionTokenFile: token('completion-token', '7') },
      announcement: { secretFile: token('announcement-token', '9'), brokerPort: 31683, guestPort: 31681 } };
    const gatewayToken = 'a'.repeat(64);
    const gateway = process.env.TURNLINK_DEEPSEEK_VM === '1' ? await startDeepSeekTestGateway({ accessToken: gatewayToken,
      authFile: join(homedir(), '.local/share/opencode/auth.json') }) : undefined;
    if (gateway) { config.modelTunnel = { hostPort: gateway.port, guestPort: 31680 }; t.after(() => gateway.close()); }
    const file = join(root, 'config.json'); writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const proc = spawn(process.execPath, ['src/opencode-contained-host.js', '--config', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '', containerID, volumeName, guest; proc.stderr.on('data', chunk => { errors += chunk; });
    const exit = once(proc, 'exit');
    t.after(async () => {
      guest?.kill('SIGKILL'); if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
      await exit; if (containerID) try { execFileSync(docker, ['rm', '--force', containerID], { stdio: 'ignore' }); } catch {}
      if (volumeName) try { execFileSync(docker, ['volume', 'rm', volumeName], { stdio: 'ignore' }); } catch {}
      rmSync(root, { recursive: true, force: true });
    });
    const [line] = await Promise.race([once(createInterface({ input: proc.stdout }), 'line'), exit.then(() => { throw new Error(`CLI exited: ${errors}`); })]);
    const ready = JSON.parse(line); assert.equal(ready.state, 'ready'); containerID = ready.containerID;
    const [container] = JSON.parse(execFileSync(docker, ['inspect', containerID], { encoding: 'utf8' }));
    volumeName = container.Mounts.find(mount => mount.Destination === '/var/lib/turnlink')?.Name;
    assert.match(volumeName, /^turnlink-opencode-volume-/);
    if (gateway) {
      assert.equal(container.HostConfig.NetworkMode, 'none');
      const probe = `const r=await fetch('http://127.0.0.1:31680/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+process.env.TEST_GATEWAY_TOKEN,'content-type':'application/json'},body:JSON.stringify({model:'synthetic',messages:[{role:'user',content:'Reply only with OK.'}],max_tokens:8})});const b=await r.json();if(!r.ok||typeof b.choices?.[0]?.message?.content!=='string')process.exitCode=1;else console.log('DEEPSEEK_VM_OK');`;
      const { stdout } = await promisify(execFile)(docker, ['exec', '-e', `TEST_GATEWAY_TOKEN=${gatewayToken}`, containerID,
        '/usr/local/bin/turnlink-node', '--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 45000 });
      assert.equal(stdout.trim(), 'DEEPSEEK_VM_OK');
    }
    const program = `import {ChannelClient} from '/code/src/client.js'; const c=new ChannelClient({url:'ws://127.0.0.1:31683',token:'${'1'.repeat(64)}',credentialDirectory:'/tmp/proofs'}); await c.request('join',{channel:'cli-test',name:'vm',role:'test',harness:'opencode',sessionId:'ses_cli',project:{name:'fixture',root:'/code'}}); await c.subscribe('opencode:ses_cli'); console.log('READY'); c.on('message',async m=>{if(m.text==='cli-message'){console.log('DELIVERED');c.close();}});`;
    guest = spawn(docker, ['exec', '-i', containerID, '/usr/local/bin/turnlink-node', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
    let guestErrors = ''; guest.stderr.on('data', chunk => { guestErrors += chunk; });
    const lines = createInterface({ input: guest.stdout }), guestExit = once(guest, 'exit');
    const [first] = await Promise.race([once(lines, 'line'), guestExit.then(() => { throw new Error(`Guest exited: ${guestErrors}`); })]);
    assert.equal(first, 'READY');
    const client = new ChannelClient({ url: `ws://127.0.0.1:${ready.brokerPort}`, token: '1'.repeat(64), credentialDirectory: dir('proofs') });
    try {
      await client.request('join', { channel: 'cli-test', name: 'host', role: 'test', harness: 'codex', sessionId: 'cli-host', project: { name: 'fixture', root: '/tmp' } });
      const delivered = once(lines, 'line');
      await client.request('send', { agentId: 'codex:cli-host', to: 'opencode:ses_cli', text: 'cli-message', messageId: 'cli-message' });
      assert.equal((await delivered)[0], 'DELIVERED');
    } finally { client.close(); }
  });
