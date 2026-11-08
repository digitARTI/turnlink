import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicWrite, privateTemp } from '../src/storage.js';
import { CodexContainedMcp } from '../src/codex-contained-mcp.js';
import { runContainedMcpStdio } from '../src/codex-contained-mcp-stdio.js';
import { cleanupContainedMcpPeer } from '../src/codex-contained-mcp-peer.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const enabled = process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE === '1';
const docker = '/opt/homebrew/bin/docker';
const call = (...args) => execFileSync(docker, args, { encoding: 'utf8', timeout: 15000 }).trim();

const fixtureScript = readFileSync(resolve('test/fixtures/contained-mcp.sh'), 'utf8');

test('contained MCP rejects invalid images and caller-controlled paths', () => {
  assert.throws(() => new CodexContainedMcp({ directory: '/tmp/unused', docker: 'docker', spec: { resourceID: randomUUID(), image: 'alpine:latest', command: ['sh'] } }));
  assert.throws(() => new CodexContainedMcp({ directory: 'relative', spec: { resourceID: randomUUID(), image: `sha256:${'a'.repeat(64)}`, command: ['sh'] } }));
});

test('contained MCP refuses a remote Docker daemon before creating a container', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-remote-');
  const prior = process.env.DOCKER_HOST;
  t.after(() => { if (prior === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = prior; rmSync(root, { recursive: true, force: true }); });
  process.env.DOCKER_HOST = 'tcp://example.invalid:2375';
  const owner = new CodexContainedMcp({ directory: root, docker, spec: { resourceID: randomUUID(), image: `sha256:${'a'.repeat(64)}`, command: ['sh'] } });
  await assert.rejects(owner.create(), /CONTAINED_MCP_UNAVAILABLE/);
});

test('an uncertain stop is observed by a successor without dispatching it again', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-stop-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resourceID = randomUUID(), operationID = randomUUID(), containerID = 'b'.repeat(64);
  const spec = { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['sh'] };
  const inspectFile = join(root, 'inspect.json'), calls = join(root, 'calls'), shim = join(root, 'docker');
  const item = { Id: containerID, Name: `/turnlink-mcp-${operationID}`, Image: spec.image,
    Config: { Labels: { 'org.turnlink.mcp.owner': operationID }, Cmd: spec.command, OpenStdin: true },
    HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidMode: '', IpcMode: 'private',
      UsernsMode: '', RestartPolicy: { Name: 'no' }, PidsLimit: 128, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] },
    NetworkSettings: { Networks: {} }, Mounts: [], State: { Running: true, Status: 'running' } };
  writeFileSync(inspectFile, JSON.stringify([item]));
  writeFileSync(shim, `#!${process.execPath}\nconst fs = require('node:fs');\nconst op = process.argv[2];\nif (op === 'info') console.log('local-daemon');\nelse if (op === 'inspect') process.stdout.write(fs.readFileSync(${JSON.stringify(inspectFile)}));\nelse if (op === 'stop') { fs.appendFileSync(${JSON.stringify(calls)}, 'stop\\n'); process.exitCode = 1; }\nelse process.exitCode = 1;\n`, { mode: 0o700 });
  atomicWrite(join(root, `${resourceID}.json`), JSON.stringify({ version: 1, resourceID, operationID, daemonID: 'local-daemon',
    image: spec.image, commandDigest: createHash('sha256').update(JSON.stringify(spec.command)).digest('hex'),
    name: `turnlink-mcp-${operationID}`, phase: 'started', containerID, wrapperPID: 123 }));
  const previousHost = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = 'unix:///tmp/turnlink-test-docker.sock';
  let owner, successor;
  try { owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); successor = new CodexContainedMcp({ directory: root, spec, docker: shim }); }
  finally { if (previousHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previousHost; }
  const identity = { resourceID, operationID, containerID, wrapperPID: 123, daemonID: 'local-daemon' };
  await assert.rejects(owner.stopExact({ ...identity, daemonID: 'other-daemon' }), /CONTAINED_MCP_UNAVAILABLE/);
  assert.equal(existsSync(calls), false);
  await assert.rejects(owner.stopExact(identity), /CONTAINED_MCP_UNCERTAIN/);
  await assert.rejects(successor.stopExact(identity), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(readFileSync(calls, 'utf8'), 'stop\n');
  item.State = { Running: false, Status: 'exited' }; writeFileSync(inspectFile, JSON.stringify([item]));
  assert.equal((await successor.stopExact(identity)).status, 'stopped_local');
  assert.equal((await successor.stopExact(identity)).status, 'stopped_local');
  assert.equal(readFileSync(calls, 'utf8'), 'stop\n');
});

test('stop can be retried when Docker was proven not to have spawned', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-no-spawn-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resourceID = randomUUID(), operationID = randomUUID(), containerID = 'd'.repeat(64);
  const spec = { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['sh'] };
  const shim = join(root, 'docker'), marker = join(root, 'remove-shim'), state = join(root, 'state'), calls = join(root, 'calls');
  const item = { Id: containerID, Name: `/turnlink-mcp-${operationID}`, Image: spec.image,
    Config: { Labels: { 'org.turnlink.mcp.owner': operationID }, Cmd: spec.command, OpenStdin: true },
    HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidMode: '', IpcMode: 'private',
      UsernsMode: '', RestartPolicy: { Name: 'no' }, PidsLimit: 128, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] },
    NetworkSettings: { Networks: {} }, Mounts: [] };
  const script = `#!${process.execPath}\nconst fs = require('node:fs');\nconst op = process.argv[2];\nif (op === 'info') console.log('local-daemon');\nelse if (op === 'inspect') { const item = ${JSON.stringify(item)}; const running = fs.readFileSync(${JSON.stringify(state)}, 'utf8') === 'running'; item.State = { Running: running, Status: running ? 'running' : 'exited' }; console.log(JSON.stringify([item])); if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); fs.unlinkSync(${JSON.stringify(shim)}); } }\nelse if (op === 'stop') { fs.appendFileSync(${JSON.stringify(calls)}, 'stop\\n'); fs.writeFileSync(${JSON.stringify(state)}, 'exited'); }\nelse process.exitCode = 1;\n`;
  writeFileSync(shim, script, { mode: 0o700 }); writeFileSync(state, 'running'); writeFileSync(marker, '1');
  atomicWrite(join(root, `${resourceID}.json`), JSON.stringify({ version: 1, resourceID, operationID, daemonID: 'local-daemon',
    image: spec.image, commandDigest: createHash('sha256').update(JSON.stringify(spec.command)).digest('hex'),
    name: `turnlink-mcp-${operationID}`, phase: 'started', containerID }));
  const previousHost = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = 'unix:///tmp/turnlink-test-docker.sock';
  let owner, successor;
  try { owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); successor = new CodexContainedMcp({ directory: root, spec, docker: shim }); }
  finally { if (previousHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previousHost; }
  await assert.rejects(owner.stop(), /CONTAINED_MCP_UNAVAILABLE/);
  assert.equal(JSON.parse(readFileSync(join(root, `${resourceID}.json`), 'utf8')).phase, 'started');
  assert.equal(existsSync(calls), false);
  writeFileSync(shim, script, { mode: 0o700 });
  assert.equal((await successor.stop()).status, 'stopped_local');
  assert.equal(readFileSync(calls, 'utf8'), 'stop\n');
});

test('a lost removal reply for a never-started container is reconciled without replay', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-create-remove-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resourceID = randomUUID(), operationID = randomUUID(), containerID = 'c'.repeat(64);
  const spec = { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['sh'] };
  const shim = join(root, 'docker'), calls = join(root, 'calls'), stateFile = join(root, 'present');
  const item = { Id: containerID, Name: `/turnlink-mcp-${operationID}`, Image: spec.image,
    Config: { Labels: { 'org.turnlink.mcp.owner': operationID }, Cmd: spec.command, OpenStdin: true },
    HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidMode: '', IpcMode: 'private',
      UsernsMode: '', RestartPolicy: { Name: 'no' }, PidsLimit: 128, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] },
    NetworkSettings: { Networks: {} }, Mounts: [], State: { Running: false, Status: 'created' } };
  writeFileSync(stateFile, 'present');
  writeFileSync(shim, `#!${process.execPath}\nconst fs = require('node:fs');\nconst op = process.argv[2];\nif (op === 'info') console.log('local-daemon');\nelse if (op === 'inspect') console.log(${JSON.stringify(JSON.stringify([item]))});\nelse if (op === 'rm') { fs.appendFileSync(${JSON.stringify(calls)}, 'rm\\n'); process.exitCode = 1; }\nelse if (op === 'ps') { if (fs.existsSync(${JSON.stringify(stateFile)})) console.log(${JSON.stringify(containerID)}); }\nelse process.exitCode = 1;\n`, { mode: 0o700 });
  atomicWrite(join(root, `${resourceID}.json`), JSON.stringify({ version: 1, resourceID, operationID, daemonID: 'local-daemon',
    image: spec.image, commandDigest: createHash('sha256').update(JSON.stringify(spec.command)).digest('hex'),
    name: `turnlink-mcp-${operationID}`, phase: 'created', containerID }));
  const previousHost = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = 'unix:///tmp/turnlink-test-docker.sock';
  let owner, successor;
  try { owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); successor = new CodexContainedMcp({ directory: root, spec, docker: shim }); }
  finally { if (previousHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previousHost; }
  await assert.rejects(owner.remove(), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(JSON.parse(readFileSync(join(root, `${resourceID}.json`), 'utf8')).phase, 'removing');
  await assert.rejects(successor.remove(), /CONTAINED_MCP_UNCERTAIN/);
  await assert.rejects(successor.observe(), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(readFileSync(calls, 'utf8'), 'rm\n');
  rmSync(stateFile);
  const watchdog = spawn(process.execPath, ['src/codex-contained-mcp-watchdog.js'], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DOCKER_HOST: 'unix:///tmp/turnlink-test-docker.sock' },
  });
  const ready = once(watchdog.stdout, 'data'), exited = once(watchdog, 'exit');
  watchdog.stdin.write(`${JSON.stringify({ directory: root, spec, docker: shim })}\n`);
  assert.equal(String((await ready)[0]), 'READY\n');
  watchdog.stdin.end();
  assert.deepEqual(await exited, [0, null]);
  assert.equal(JSON.parse(readFileSync(join(root, `${resourceID}.json`), 'utf8')).phase, 'removed');
  assert.equal((await successor.observe()).phase, 'removed');
  await successor.remove();
  assert.equal(readFileSync(calls, 'utf8'), 'rm\n');
});

test('removal can be retried when Docker was proven not to have spawned', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-remove-no-spawn-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resourceID = randomUUID(), operationID = randomUUID(), containerID = 'e'.repeat(64);
  const spec = { resourceID, image: `sha256:${'a'.repeat(64)}`, command: ['sh'] };
  const shim = join(root, 'docker'), marker = join(root, 'remove-shim'), present = join(root, 'present'), calls = join(root, 'calls');
  const item = { Id: containerID, Name: `/turnlink-mcp-${operationID}`, Image: spec.image,
    Config: { Labels: { 'org.turnlink.mcp.owner': operationID }, Cmd: spec.command, OpenStdin: true },
    HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidMode: '', IpcMode: 'private',
      UsernsMode: '', RestartPolicy: { Name: 'no' }, PidsLimit: 128, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] },
    NetworkSettings: { Networks: {} }, Mounts: [], State: { Running: false, Status: 'created' } };
  const script = `#!${process.execPath}\nconst fs = require('node:fs'); const op = process.argv[2];\nif (op === 'info') console.log('local-daemon');\nelse if (op === 'inspect') { console.log(${JSON.stringify(JSON.stringify([item]))}); if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); fs.unlinkSync(${JSON.stringify(shim)}); } }\nelse if (op === 'rm') { fs.appendFileSync(${JSON.stringify(calls)}, 'rm\\n'); fs.unlinkSync(${JSON.stringify(present)}); }\nelse if (op === 'ps') { if (fs.existsSync(${JSON.stringify(present)})) console.log(${JSON.stringify(containerID)}); }\nelse process.exitCode = 1;\n`;
  writeFileSync(shim, script, { mode: 0o700 }); writeFileSync(present, '1'); writeFileSync(marker, '1');
  const file = join(root, `${resourceID}.json`);
  atomicWrite(file, JSON.stringify({ version: 1, resourceID, operationID, daemonID: 'local-daemon', image: spec.image,
    commandDigest: createHash('sha256').update(JSON.stringify(spec.command)).digest('hex'), name: `turnlink-mcp-${operationID}`, phase: 'created', containerID }));
  const previousHost = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = 'unix:///tmp/turnlink-test-docker.sock';
  let owner, successor;
  try { owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); successor = new CodexContainedMcp({ directory: root, spec, docker: shim }); }
  finally { if (previousHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previousHost; }
  await assert.rejects(owner.remove(), /CONTAINED_MCP_UNAVAILABLE/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).phase, 'created'); assert.equal(existsSync(calls), false);
  writeFileSync(shim, script, { mode: 0o700 });
  await successor.remove();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).phase, 'removed'); assert.equal(readFileSync(calls, 'utf8'), 'rm\n');
});

test('directory-selected contained MCP refuses duplicate directories and resource IDs', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-selection-'), source = join(root, 'source'), target = join(root, 'target');
  mkdirSync(source); mkdirSync(target); t.after(() => rmSync(root, { recursive: true, force: true }));
  const resourceID = randomUUID(), base = { version: 2, directory: root, docker, spec: { image: `sha256:${'a'.repeat(64)}`, command: ['sh'] } };
  await assert.rejects(runContainedMcpStdio({ ...base, instances: [{ cwd: source, resourceID }, { cwd: source, resourceID: randomUUID() }] }), /CONTAINED_MCP_STDIO_UNAVAILABLE/);
  const alias = join(root, 'source-alias'); symlinkSync(source, alias);
  await assert.rejects(runContainedMcpStdio({ ...base, instances: [{ cwd: source, resourceID }, { cwd: alias, resourceID: randomUUID() }] }), /CONTAINED_MCP_STDIO_UNAVAILABLE/);
  await assert.rejects(runContainedMcpStdio({ ...base, instances: [{ cwd: source, resourceID }, { cwd: target, resourceID }] }), /CONTAINED_MCP_STDIO_UNAVAILABLE/);
  await assert.rejects(runContainedMcpStdio({ ...base, instances: [{ cwd: source, resourceID }] }), /CONTAINED_MCP_STDIO_UNAVAILABLE/);
});

test('source and destination use distinct contained MCP owners concurrently', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-pair-'), source = join(root, 'source'), target = join(root, 'target'), directory = join(root, 'owners');
  mkdirSync(source); mkdirSync(target); const image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { image, command: ['sh', '-c', fixtureScript] }, instances = [{ cwd: source, resourceID: randomUUID() }, { cwd: target, resourceID: randomUUID() }];
  const configFile = join(root, 'config.json'); writeFileSync(configFile, JSON.stringify({ version: 2, directory, docker, spec, instances }), { mode: 0o600 });
  const owners = instances.map(({ resourceID }) => new CodexContainedMcp({ directory, docker, spec: { ...spec, resourceID } }));
  const clients = instances.map(({ cwd }) => { const client = new Client({ name: 'turnlink-pair-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/codex-contained-mcp-stdio.js'), '--config', configFile], cwd, stderr: 'pipe' });
    return { client, transport }; });
  const ids = [];
  t.after(async () => {
    for (const { client } of clients) await client.close().catch(() => {});
    for (const owner of owners) { try { const state = await owner.observe(); if (!ids.includes(state.containerID)) ids.push(state.containerID); } catch {} }
    for (const id of ids) { try { call('rm', '-f', id); } catch {} }
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all(clients.map(({ client, transport }) => client.connect(transport)));
  for (const [index, owner] of owners.entries()) { const state = await owner.observe(); assert.equal(state.running, true);
    assert.equal(state.wrapperPID, clients[index].transport.pid); ids.push(state.containerID); }
  assert.notEqual(ids[0], ids[1]);
  const peerController = new AbortController(), peer = await owners[0].acquireRunningObservation({ signal: peerController.signal });
  try {
    const code = 'import json,socket,sys,struct\np=json.load(sys.stdin);bad=socket.socket(socket.AF_UNIX);bad.settimeout(2);bad.connect(p["path"]);wrong=("1" if p["nonce"][0]=="0" else "0")+p["nonce"][1:];bad.sendall((wrong+"\\n").encode());assert bad.recv(3)==b"";bad.close()\ns=socket.socket(socket.AF_UNIX);s.settimeout(2);s.connect(p["path"])\npid=(int.from_bytes(s.getsockopt(0,2,4),sys.byteorder,signed=True) if sys.platform=="darwin" else struct.unpack("3i",s.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[0])\ns.sendall((p["nonce"]+"\\n").encode());assert s.recv(3)==b"ok\\n";print(pid)';
    const pid = Number(execFileSync('python3', ['-c', code], { input: JSON.stringify(peer.peer), encoding: 'utf8', timeout: 5000 }).trim());
    assert.equal(pid, clients[0].transport.pid); assert.equal(await peer.revalidate(), true);
  } finally { peerController.abort(); }
  await clients[0].client.close();
  let stopped;
  for (let attempt = 0; attempt < 50; attempt++) { try { stopped = await owners[0].observe(); if (stopped.phase === 'stopped') break; } catch (error) { if (error.code !== 'ELOCKED') throw error; } await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  assert.equal(stopped.phase, 'stopped'); assert.equal((await owners[1].observe()).running, true);
  assert.equal((await clients[1].client.callTool({ name: 'detach', arguments: {} })).content[0].text, 'started');
});

test('contained MCP owner runs SDK calls and stops detached descendants with the exact local container', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-mcp-');
  const image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', fixtureScript] };
  const owner = new CodexContainedMcp({ directory: root, spec, docker });
  let id, processHandle;
  t.after(async () => {
    if (id) { try { call('rm', '-f', id); } catch { /* Already removed. */ } }
    processHandle?.child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true });
  });
  const created = await owner.create(); id = created.containerID;
  const foreign = new CodexContainedMcp({ directory: root, spec, docker, operationID: randomUUID() });
  await assert.rejects(foreign.observe(), /CONTAINED_MCP_UNAVAILABLE/);
  await assert.rejects(foreign.stop(), /CONTAINED_MCP_UNAVAILABLE/);
  assert.equal((await owner.observe()).phase, 'created');
  const journalFile = join(root, `${spec.resourceID}.json`), journal = JSON.parse(readFileSync(journalFile, 'utf8'));
  atomicWrite(journalFile, JSON.stringify({ ...journal, daemonID: 'different-daemon' }));
  await assert.rejects(owner.observe(), /CONTAINED_MCP_UNAVAILABLE/);
  const { containerID: _removed, ...lostReply } = journal;
  atomicWrite(journalFile, JSON.stringify({ ...lostReply, phase: 'creating' }));
  const recovered = new CodexContainedMcp({ directory: root, spec, docker });
  assert.equal((await recovered.observe()).containerID, id);
  assert.equal((await recovered.observe()).phase, 'created');
  const buffer = new ReadBuffer();
  const transport = {
    async start() {
      processHandle = await owner.start();
      processHandle.child.stdout.on('data', chunk => { buffer.append(chunk); for (;;) { const msg = buffer.readMessage(); if (!msg) break; this.onmessage?.(msg); } });
      processHandle.child.stdout.on('error', error => this.onerror?.(error));
      processHandle.exited.then(() => this.onclose?.());
    },
    async send(message) { processHandle.child.stdin.write(serializeMessage(message)); },
    async close() { await owner.stop(); },
  };
  const client = new Client({ name: 'turnlink-contained-test', version: '1' });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, 'detach');
  assert.equal((await client.callTool({ name: 'detach', arguments: {} })).content[0].text, 'started');
  await assert.rejects(owner.start(), /CONTAINED_MCP_UNAVAILABLE/);
  const processes = call('top', id, '-eo', 'pid,ppid,pgid,args').split('\n').slice(1).map(line => line.trim().split(/\s+/));
  const descendant = processes.find(row => row.includes('sleep') && row.includes('300'));
  assert.ok(descendant); assert.equal(descendant[0], descendant[2]);
  const receipt = await owner.stop(); assert.equal(receipt.status, 'stopped_local');
  assert.equal((await owner.observe()).running, false);
  const leaseController = new AbortController();
  let observation = await owner.acquireStoppedObservation({ signal: leaseController.signal });
  assert.equal(observation.containerID, id); assert.equal(observation.check(), true); assert.equal(await observation.revalidate(), true);
  assert.equal(observation[codexVerifierLease], undefined, 'a single container must not authorize native MCP cleanup');
  await assert.rejects(recovered.observe(), error => error.code === 'ELOCKED');
  const stoppedJournal = JSON.parse(readFileSync(journalFile, 'utf8'));
  atomicWrite(journalFile, JSON.stringify({ ...stoppedJournal, daemonID: 'changed-daemon' }));
  assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  atomicWrite(journalFile, JSON.stringify(stoppedJournal)); assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  observation.release(); observation = await owner.acquireStoppedObservation({ signal: leaseController.signal });
  call('update', '--restart=always', id);
  await assert.rejects(observation.revalidate(), /CONTAINED_MCP_UNAVAILABLE/);
  call('update', '--restart=no', id);
  await assert.rejects(observation.revalidate(), /CONTAINED_MCP_UNAVAILABLE/);
  observation.release(); observation = await owner.acquireStoppedObservation({ signal: leaseController.signal });
  assert.equal(await observation.revalidate(), true);
  leaseController.abort(); assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  assert.equal((await recovered.observe()).phase, 'stopped');
  call('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    image, 'sh', '-c', 'test ! -e "/proc/$1"', 'sh', descendant[0]);
  await client.close().catch(() => {});
  await owner.remove(); id = undefined;
});


test('contained MCP can be stopped by its successor after the owner is killed', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-crash-');
  const image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'setsid sh -c "exec sleep 300" </dev/null >/dev/null 2>&1 & echo READY; exec sleep 300'] };
  const configFile = join(root, 'config.json'); writeFileSync(configFile, JSON.stringify({ directory: root, spec, docker }), { mode: 0o600 });
  const worker = spawn(process.execPath, ['test/fixtures/codex-contained-mcp-owner-crash.js', configFile], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(worker, 'exit'); let id, attachPid, output = '', errors = '';
  worker.stderr.on('data', chunk => { errors += chunk.toString(); });
  t.after(async () => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
    await exited;
    if (id) { try { call('rm', '-f', id); } catch { /* Already removed. */ } }
    if (attachPid) { try { process.kill(attachPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    rmSync(root, { recursive: true, force: true });
  });
  const ready = new Promise((resolve, reject) => {
    worker.stdout.on('data', chunk => { output += chunk.toString(); const end = output.indexOf('\n');
      if (end >= 0) { try { resolve(JSON.parse(output.slice(0, end))); } catch (error) { reject(error); } } });
    worker.once('exit', () => reject(new Error(`Owner exited before ready: ${errors}`)));
  });
  let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owner startup timed out')), 20000); });
  let observed; try { observed = await Promise.race([ready, timeout]); } finally { clearTimeout(timer); }
  id = observed.containerID; attachPid = observed.attachPid; assert.match(id, /^[a-f0-9]{64}$/); assert.ok(attachPid > 0);
  const processes = call('top', id, '-eo', 'pid,ppid,pgid,args').split('\n').slice(1).map(line => line.trim().split(/\s+/));
  const descendant = processes.find(row => row.includes('sleep') && row.includes('300') && row[0] === row[2]);
  assert.ok(descendant, 'detached descendant must be alive before owner death');
  worker.kill('SIGKILL'); const [code, signal] = await exited; assert.equal(code, null); assert.equal(signal, 'SIGKILL');
  const successor = new CodexContainedMcp({ directory: root, spec, docker });
  const receipt = await successor.stop(); assert.equal(receipt.containerID, id); assert.equal(receipt.status, 'stopped_local');
  call('run', '--rm', '--pull=never', '--pid=host', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    image, 'sh', '-c', 'test ! -e "/proc/$1"', 'sh', descendant[0]);
  await successor.remove(); id = undefined;
});

for (const dispatch of [true, false]) test(`uncertain real Docker stop ${dispatch ? 'completed' : 'not dispatched'} is never replayed`, { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-stop-real-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'exec sleep 300'] }, count = join(root, 'calls'), shim = join(root, 'docker-shim');
  writeFileSync(shim, `#!/bin/sh\nif [ "$1" = stop ]; then echo attempt >> '${count}'; ${dispatch ? '/opt/homebrew/bin/docker "$@" >/dev/null || exit 1;' : ''} exit 1; fi\nexec /opt/homebrew/bin/docker "$@"\n`, { mode: 0o700 });
  const owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); let id, started;
  t.after(async () => { started?.child.kill('SIGKILL'); if (id) { try { call('rm', '-f', id); } catch {} }
    if (started) await started.exited; rmSync(root, { recursive: true, force: true }); });
  id = (await owner.create()).containerID; started = await owner.start();
  let state;
  for (let attempt = 0; attempt < 50; attempt++) { state = await owner.observe(); if (state.running) break; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  assert.equal(state.running, true);
  await assert.rejects(owner.stop(), /CONTAINED_MCP_UNCERTAIN/);
  const successor = new CodexContainedMcp({ directory: root, spec, docker: shim });
  if (dispatch) {
    assert.equal((await successor.stop()).status, 'stopped_local');
    await successor.remove(); id = undefined;
  } else {
    await assert.rejects(successor.stop(), /CONTAINED_MCP_UNCERTAIN/);
    assert.equal((await successor.observe()).running, true);
  }
  assert.equal(readFileSync(count, 'utf8'), 'attempt\n');
});

test('retirement recovers a lost Docker removal reply without repeating removal', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-retire-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'exec sleep 300'] };
  const shim = join(root, 'docker-shim');
  writeFileSync(shim, '#!/bin/sh\nif [ "$1" = rm ]; then /opt/homebrew/bin/docker "$@" >/dev/null || exit 1; exit 1; fi\nexec /opt/homebrew/bin/docker "$@"\n', { mode: 0o700 });
  const owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); let id, started;
  t.after(() => { started?.child.kill('SIGKILL'); if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  id = (await owner.create()).containerID; started = await owner.start();
  let state;
  for (let attempt = 0; attempt < 50; attempt++) { state = await owner.observe(); if (state.running) break; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  assert.equal(state.running, true); await owner.stop(); await started.exited;
  await assert.rejects(owner.retire(), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(JSON.parse(readFileSync(join(root, `${spec.resourceID}.json`), 'utf8')).phase, 'removing');
  const successor = new CodexContainedMcp({ directory: root, spec, docker });
  const proof = await successor.retire(); assert.equal(proof.containerID, id); assert.equal(proof.status, 'removed_local');
  assert.deepEqual(await successor.retire(), proof);
  assert.equal(JSON.parse(readFileSync(join(root, `${spec.resourceID}.json`), 'utf8')).phase, 'removed');
  const controller = new AbortController(), observation = await successor.acquireRetiredObservation({ signal: controller.signal });
  assert.equal(observation.containerID, id); assert.equal(observation.check(), true); assert.equal(await observation.revalidate(), true);
  assert.equal(observation[codexVerifierLease], undefined, 'a retired container alone must not release an MCP broker hold');
  await assert.rejects(owner.retire(), error => error.code === 'ELOCKED');
  const recordFile = join(root, `${spec.resourceID}.json`), original = readFileSync(recordFile, 'utf8');
  atomicWrite(recordFile, JSON.stringify({ ...JSON.parse(original), daemonID: 'different-daemon' }));
  assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  atomicWrite(recordFile, original); assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  controller.abort(); assert.throws(() => observation.check(), /CONTAINED_MCP_UNAVAILABLE/);
  await assert.rejects(successor.create(), /CONTAINED_MCP_UNAVAILABLE/);
  id = undefined;
});

test('never-started container removal recovers a lost real Docker reply without replay', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-created-retire-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'exec sleep 300'] };
  const shim = join(root, 'docker-shim'), count = join(root, 'calls');
  writeFileSync(shim, `#!/bin/sh\nif [ "$1" = rm ]; then echo attempt >> '${count}'; /opt/homebrew/bin/docker "$@" >/dev/null || exit 1; exit 1; fi\nexec /opt/homebrew/bin/docker "$@"\n`, { mode: 0o700 });
  const owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); let id;
  t.after(() => { if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  id = (await owner.create()).containerID;
  assert.equal((await owner.observe()).status, 'created');
  await assert.rejects(owner.remove(), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(JSON.parse(readFileSync(join(root, `${spec.resourceID}.json`), 'utf8')).phase, 'removing');
  const successor = new CodexContainedMcp({ directory: root, spec, docker: shim });
  const observation = await successor.observe();
  assert.equal(observation.phase, 'removed'); assert.equal(observation.containerID, id);
  await successor.remove();
  assert.equal(readFileSync(count, 'utf8'), 'attempt\n');
  id = undefined;
});

test('retirement never repeats an uncertain removal while the container remains', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-retire-pending-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'exec sleep 300'] }, count = join(root, 'calls');
  const shim = join(root, 'docker-shim');
  writeFileSync(shim, `#!/bin/sh\nif [ "$1" = rm ]; then echo attempt >> '${count}'; exit 1; fi\nexec /opt/homebrew/bin/docker "$@"\n`, { mode: 0o700 });
  const owner = new CodexContainedMcp({ directory: root, spec, docker: shim }); let id, started;
  t.after(() => { started?.child.kill('SIGKILL'); if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  id = (await owner.create()).containerID; started = await owner.start();
  let state;
  for (let attempt = 0; attempt < 50; attempt++) { state = await owner.observe(); if (state.running) break; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  assert.equal(state.running, true); await owner.stop(); await started.exited;
  await assert.rejects(owner.retire(), /CONTAINED_MCP_UNCERTAIN/);
  await assert.rejects(owner.retire(), /CONTAINED_MCP_UNCERTAIN/);
  assert.equal(readFileSync(count, 'utf8'), 'attempt\n');
  assert.equal(JSON.parse(readFileSync(join(root, `${spec.resourceID}.json`), 'utf8')).phase, 'removing');
});


test('stdio entry point stops a server that stays alive after client disconnect', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-stdio-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', `${fixtureScript}\nexec sleep 300`] }, config = { version: 1, directory: root, docker, spec };
  const configFile = join(root, 'config.json'); writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  const owner = new CodexContainedMcp(config), client = new Client({ name: 'turnlink-stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/codex-contained-mcp-stdio.js'), '--config', configFile], stderr: 'pipe' });
  let id;
  t.after(async () => { await client.close().catch(() => {}); if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  await client.connect(transport);
  const observation = await owner.observe(); id = observation.containerID; assert.equal(observation.running, true);
  assert.equal((await client.callTool({ name: 'detach', arguments: {} })).content[0].text, 'started');
  await client.close();
  let result;
  for (let attempt = 0; attempt < 30; attempt++) { result = await owner.observe(); if (result.phase === 'stopped') break; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  assert.equal(result.phase, 'stopped'); assert.equal(result.running, false);
  await owner.remove(); id = undefined;
});

test('watchdog stops the exact contained resource after the stdio wrapper is killed', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-stdio-crash-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', `${fixtureScript}\nexec sleep 300`] }, config = { version: 1, directory: root, docker, spec };
  const configFile = join(root, 'config.json'); writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  const client = new Client({ name: 'turnlink-stdio-crash-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/codex-contained-mcp-stdio.js'), '--config', configFile], stderr: 'pipe' });
  const successor = new CodexContainedMcp(config); let id;
  t.after(async () => { await client.close().catch(() => {}); if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  await client.connect(transport);
  const before = await successor.observe(); id = before.containerID;
  assert.equal((await client.callTool({ name: 'detach', arguments: {} })).content[0].text, 'started');
  const peerController = new AbortController(), running = await successor.acquireRunningObservation({ signal: peerController.signal });
  const peerPath = running.peer.path;
  cleanupContainedMcpPeer({ ...running.peer, inode: running.peer.inode === '0' ? '1' : '0' });
  assert.equal(existsSync(peerPath), true, 'a changed socket identity must not be unlinked');
  peerController.abort();
  const closed = new Promise(resolve => { const previous = transport.onclose; transport.onclose = () => { previous?.(); resolve(); }; });
  const pid = transport.pid; assert.ok(pid > 0); process.kill(pid, 'SIGKILL'); await closed;
  let recovered;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { recovered = await successor.observe(); if (recovered.phase === 'stopped') break; } catch (error) { if (error.code !== 'ELOCKED') throw error; }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(recovered.resourceID, spec.resourceID); assert.equal(recovered.containerID, id);
  assert.equal(recovered.phase, 'stopped'); assert.equal(recovered.running, false);
  for (let attempt = 0; attempt < 50 && existsSync(peerPath); attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 100));
  assert.equal(existsSync(peerPath), false); assert.equal(existsSync(dirname(peerPath)), false);
  await successor.remove(); id = undefined;
});

test('wrapper stops its contained resource if its watchdog dies', { skip: !enabled || process.platform !== 'darwin', timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-watchdog-crash-'), image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', `${fixtureScript}\nexec sleep 300`] }, config = { version: 1, directory: root, docker, spec };
  const configFile = join(root, 'config.json'); writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  const client = new Client({ name: 'turnlink-watchdog-crash-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/codex-contained-mcp-stdio.js'), '--config', configFile], stderr: 'pipe' });
  const successor = new CodexContainedMcp(config); let id;
  t.after(async () => { await client.close().catch(() => {}); if (id) { try { call('rm', '-f', id); } catch {} } rmSync(root, { recursive: true, force: true }); });
  await client.connect(transport); const before = await successor.observe(); id = before.containerID;
  const pids = execFileSync('/usr/bin/pgrep', ['-P', String(transport.pid)], { encoding: 'utf8' }).trim().split(/\s+/);
  const watchdog = pids.find(pid => execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).includes('codex-contained-mcp-watchdog.js'));
  assert.ok(watchdog); process.kill(Number(watchdog), 'SIGKILL');
  let recovered;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { recovered = await successor.observe(); if (recovered.phase === 'stopped') break; } catch (error) { if (error.code !== 'ELOCKED') throw error; }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(recovered.containerID, id); assert.equal(recovered.phase, 'stopped'); assert.equal(recovered.running, false);
  await successor.remove(); id = undefined;
});

test('contained MCP observations do not prove uninterrupted network isolation', { skip: !enabled, timeout: 60000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-network-history-');
  const image = call('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', fixtureScript] };
  const owner = new CodexContainedMcp({ directory: root, spec, docker, wrapperPID: process.pid });
  let containerID, started, observation;
  t.after(async () => {
    observation?.release();
    if (containerID) { try { call('rm', '-f', containerID); } catch {} }
    if (started && started.child.exitCode === null && started.child.signalCode === null) started.child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  });
  containerID = (await owner.create()).containerID;
  started = await owner.start();
  const signal = new AbortController().signal;
  observation = await owner.acquireRunningObservation({ signal });
  const identity = { resourceID: observation.resourceID, operationID: observation.operationID,
    containerID: observation.containerID, wrapperPID: observation.wrapperPID, daemonID: observation.daemonID };
  call('network', 'disconnect', 'none', containerID); call('network', 'connect', 'bridge', containerID);
  await assert.rejects(observation.revalidate(), /CONTAINED_MCP_UNAVAILABLE/);
  observation.release(); observation = undefined;
  call('network', 'disconnect', 'bridge', containerID); call('network', 'connect', 'none', containerID);
  observation = await owner.acquireRunningObservation({ signal });
  assert.equal(await observation.revalidate(), true, 'restored configuration hides the transient network attachment');
  observation.release(); observation = undefined;
  await owner.stop(); await started.exited; await owner.remove(); containerID = undefined;
  const successor = new CodexContainedMcp({ directory: root, spec, docker });
  const retired = await successor.acquireRetiredObservation({ signal, expected: identity });
  try { assert.equal(await retired.revalidate(), true, 'retired observation proves absence, not network history'); }
  finally { retired.release(); }
});
