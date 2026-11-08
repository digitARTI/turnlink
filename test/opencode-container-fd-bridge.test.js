import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

test('container stdio keeps private descriptor separate from native readiness',
  { skip: process.env.OPENCODE_DOCKER_BRIDGE_TEST !== '1', timeout: 30000 }, async () => {
    const image = process.env.OPENCODE_DOCKER_BRIDGE_IMAGE || 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    assert.match(image, /^sha256:[a-f0-9]{64}$/);
    const bridge = resolve('src/opencode-container-fd-bridge.cjs'), fixture = resolve('test/fixtures/opencode-container-fd-child.js');
    const child = spawn('docker', ['run', '--rm', '-i', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--tmpfs', '/tmp:rw,nosuid,size=32m', '--mount', `type=bind,src=${bridge},dst=/bridge.cjs,readonly`,
      '--mount', `type=bind,src=${fixture},dst=/fixture.js,readonly`, '--entrypoint', '/usr/local/bin/turnlink-node', image, '/bridge.cjs'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', data => { output += data; if (output.includes('reply:hello')) child.stdin.end(); }); child.stderr.on('data', data => { errors += data; });
    const password = 'a'.repeat(43);
    child.stdin.write(`${JSON.stringify({ entrypoint: '/fixture.js', database: '/tmp/test.sqlite', sessionID: 'ses_fixture', pluginID: 'turnlink',
      directory: '/tmp', password, environment: {} })}\nhello`);
    const [code, signal] = await once(child, 'close');
    assert.equal(signal, null); assert.equal(code, 0, errors);
    assert.equal(output, '{"url":"http://127.0.0.1:12345"}\nreply:hello', errors);
    assert.ok(!output.includes(password)); assert.ok(!errors.includes(password));
  });

test('container bridge rejects untrusted launch configuration',
  { skip: process.env.OPENCODE_DOCKER_BRIDGE_TEST !== '1', timeout: 30000 }, async () => {
    const image = process.env.OPENCODE_DOCKER_BRIDGE_IMAGE || 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    assert.match(image, /^sha256:[a-f0-9]{64}$/);
    const bridge = resolve('src/opencode-container-fd-bridge.cjs');
    for (const input of [
      { entrypoint: '/fixture.js', database: '/tmp/db', sessionID: 'ses_fixture', pluginID: 'turnlink', directory: '/tmp', password: 'a'.repeat(43), environment: { NODE_OPTIONS: '--inspect' } },
      { entrypoint: '/fixture.js', database: '/tmp/db', sessionID: 'ses_fixture', pluginID: 'turnlink', directory: '/tmp', password: 'short', environment: {} },
    ]) {
      const child = spawn('docker', ['run', '--rm', '-i', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--mount', `type=bind,src=${bridge},dst=/bridge.cjs,readonly`, '--entrypoint', '/usr/local/bin/turnlink-node', image, '/bridge.cjs'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
      child.stdin.end(`${JSON.stringify(input)}\n`);
      const [code] = await once(child, 'close'); assert.notEqual(code, 0); assert.equal(output, '');
    }
  });
