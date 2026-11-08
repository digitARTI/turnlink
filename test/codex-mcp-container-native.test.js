import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Opt-in experiment only. Container removal is not an MCP cleanup receipt:
// this test does not cover remote work, daemon loss, or broker recovery.
test('Docker removes a detached MCP-like child that closed its pipes', {
  skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 60000,
}, async () => {
  const image = 'alpine:3.21', name = `turnlink-gate2-mcp-${randomUUID()}`;
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000 }).trim();
  const observer = (...args) => docker('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', image, 'sh', '-c', ...args);
  let id;
  try {
    id = docker('run', '-d', '--pull=never', '--name', name, '--label', 'org.turnlink.gate2.probe=physical-release',
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', image,
      'sh', '-c', 'setsid sh -c "exec sleep 300" </dev/null >/dev/null 2>&1 & exec sleep 300');
    assert.match(id, /^[a-f0-9]{64}$/);
    let lines;
    for (let attempt = 0; attempt < 20; attempt++) {
      lines = docker('top', id, '-eo', 'pid,ppid,pgid,args').split('\n').slice(1);
      if (lines.length >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(lines.length, 2);
    const processes = lines.map(line => line.trim().split(/\s+/));
    const child = processes.find(row => row[1] === processes[0][0]) ?? processes.find(row => row[1] === processes[1][0]);
    assert.ok(child, 'container must contain the direct child');
    const parent = processes.find(row => row[0] === child[1]);
    assert.match(child[0], /^\d+$/);
    assert.equal(child[0], child[2], 'child must have escaped to a separate process group');
    assert.notEqual(parent[2], child[2]);
    observer('test -r "/proc/$1/stat"', 'sh', child[0]);
    docker('rm', '-f', id);
    id = undefined;
    observer('test ! -e "/proc/$1"', 'sh', child[0]);
  } finally {
    if (id) {
      docker('rm', '-f', id);
    } else {
      // A timed-out run may have created the uniquely named container without
      // returning its ID. Remove it only if our exact label is still present.
      let label;
      try {
        label = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "org.turnlink.gate2.probe"}}', name],
          { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch { /* no matching probe container */ }
      if (label === 'physical-release') docker('rm', '-f', name);
    }
  }
});

for (const ending of ['remove', 'client-crash']) test(`network-isolated Docker MCP ${ending} stops a detached tool child`, {
  skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 60000,
}, async () => {
  const image = 'alpine:3.21', name = `turnlink-gate2-mcp-${randomUUID()}`;
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000 }).trim();
  const script = [
    'while IFS= read -r line; do',
    'id=$(printf "%s" "$line" | sed -n "s/.*\\\"id\\\":\\([0-9][0-9]*\\).*/\\1/p")',
    'case "$line" in',
    '*"\\\"method\\\":\\\"initialize\\\""*) printf "{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":%s,\\\"result\\\":{\\\"protocolVersion\\\":\\\"2025-03-26\\\",\\\"capabilities\\\":{\\\"tools\\\":{}},\\\"serverInfo\\\":{\\\"name\\\":\\\"container-fixture\\\",\\\"version\\\":\\\"1\\\"}}}\\n" "$id" ;;',
    '*"\\\"method\\\":\\\"tools/list\\\""*) printf "{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":%s,\\\"result\\\":{\\\"tools\\\":[{\\\"name\\\":\\\"detach\\\",\\\"description\\\":\\\"start a fixture child\\\",\\\"inputSchema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{}}}]}}\\n" "$id" ;;',
    '*"\\\"method\\\":\\\"tools/call\\\""*) setsid sh -c "exec sleep 300" </dev/null >/dev/null 2>&1 & printf "{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":%s,\\\"result\\\":{\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"started\\\"}]}}\\n" "$id" ;;',
    'esac',
    'done',
  ].join('\n');
  const transport = new StdioClientTransport({ command: 'docker', args: ['run', '-i', '--pull=never', '--name', name,
    '--label', 'org.turnlink.gate2.probe=mcp-sdk', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', image, 'sh', '-c', script], stderr: 'pipe' });
  const client = new Client({ name: 'container-fixture-client', version: '1' });
  let id, removed = false;
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0].name, 'detach');
    assert.equal((await client.callTool({ name: 'detach', arguments: {} })).content[0].text, 'started');
    id = docker('inspect', '--format', '{{.Id}}', name);
    assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal(docker('inspect', '--format', '{{.HostConfig.NetworkMode}}', id), 'none');
    assert.equal(docker('inspect', '--format', '{{len .HostConfig.Binds}}', id), '0');
    assert.equal(docker('inspect', '--format', '{{len .Mounts}}', id), '0');
    assert.equal(docker('inspect', '--format', '{{.HostConfig.Privileged}}', id), 'false');
    assert.notEqual(docker('inspect', '--format', '{{.HostConfig.PidMode}}', id), 'host');
    const processes = docker('top', id, '-eo', 'pid,ppid,pgid,args').split('\n').slice(1).map(line => line.trim().split(/\s+/));
    const child = processes.find(row => row.includes('sleep') && row.includes('300'));
    assert.ok(child); assert.equal(child[0], child[2]);
    docker('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', image, 'sh', '-c', 'test -r "/proc/$1/stat"', 'sh', child[0]);
    if (ending === 'client-crash') {
      const cliPid = transport.pid; assert.ok(cliPid); process.kill(cliPid, 'SIGKILL');
      for (let attempt = 0; attempt < 100 && docker('inspect', '--format', '{{.State.Running}}', id) === 'true'; attempt++)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(docker('inspect', '--format', '{{.State.Running}}', id), 'false');
      docker('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', image, 'sh', '-c', 'test ! -e "/proc/$1"', 'sh', child[0]);
    }
    docker('rm', '-f', id); id = undefined; removed = true;
    docker('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', image, 'sh', '-c', 'test ! -e "/proc/$1"', 'sh', child[0]);
  } finally {
    await client.close().catch(() => {});
    if (!removed) {
      let label;
      try { label = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "org.turnlink.gate2.probe"}}', id || name],
        { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
      catch { /* not created */ }
      if (label === 'mcp-sdk') docker('rm', '-f', id || name);
    }
  }
});

// A running container's current network configuration is not a continuous
// historical guarantee while another process can control the same daemon.
test('network none can be replaced and restored between container observations', {
  skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 60000,
}, () => {
  const name = `turnlink-network-observation-${randomUUID()}`, label = 'network-observation';
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000 }).trim();
  let id;
  try {
    id = docker('create', '--pull=never', '--name', name, '--label', `org.turnlink.gate2.probe=${label}`,
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', 'alpine:3.21', 'sleep', '30');
    docker('start', id);
    const inspect = () => JSON.parse(docker('inspect', id))[0];
    const networks = () => Object.keys(inspect().NetworkSettings.Networks).sort();
    assert.deepEqual(networks(), ['none']);
    docker('network', 'disconnect', 'none', id); docker('network', 'connect', 'bridge', id);
    const connected = inspect(); assert.equal(connected.HostConfig.NetworkMode, 'none');
    assert.deepEqual(Object.keys(connected.NetworkSettings.Networks), ['bridge']);
    docker('network', 'disconnect', 'bridge', id); docker('network', 'connect', 'none', id);
    assert.deepEqual(networks(), ['none']);
  } finally {
    let actual;
    try { actual = docker('inspect', '--format', '{{index .Config.Labels "org.turnlink.gate2.probe"}}', id || name); }
    catch { /* fixture was never created */ }
    if (actual === label) docker('rm', '-f', id || name);
  }
});
