import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, renameSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';

const docker = process.env.OPENCODE_TEST_DOCKER || '/opt/homebrew/bin/docker';
const run = (...args) => execFileSync(docker, args, { encoding: 'utf8', timeout: 15000 }).trim();

test('owner rejects invalid mount modes and symlink mount sources', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-container-')));
  try {
    const link = join(root, 'link'); symlinkSync(root, link);
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec: { resourceID: randomUUID(), image: `sha256:${'a'.repeat(64)}`,
      command: ['sleep', '30'], mounts: [{ source: link, destination: '/config', mode: 'ro' }] } });
    await assert.rejects(owner.create());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('database volume rejects overlapping bind targets', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-overlap-')));
  try {
    const base = { resourceID: randomUUID(), image: `sha256:${'a'.repeat(64)}`, command: ['sleep', '30'],
      volume: { destination: '/var/lib/turnlink', mode: 'rw' } };
    for (const destination of ['/var/lib', '/var/lib/turnlink', '/var/lib/turnlink/opencode.sqlite']) {
      assert.throws(() => new OpenCodeContainedOwner({ directory: root, docker, spec: { ...base,
        mounts: [{ source: root, destination, mode: 'rw' }] } }));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('dedicated fixture code volume is identity checked and mounted read-only',
  { skip: process.env.OPENCODE_CODE_VOLUME_TEST !== '1', timeout: 30000 }, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-code-volume-')));
    const name = 'turnlink-opencode-code-fixture-9fe8c54e-9a89-4f78-8b56-6b83d736289a';
    const raw = JSON.parse(run('volume', 'inspect', name))[0];
    const codeVolume = { name, createdAt: raw.CreatedAt, mountpoint: raw.Mountpoint };
    const spec = { resourceID: randomUUID(), image: 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5',
      command: ['-e', 'setInterval(()=>{},1000)'], mounts: [], codeVolume };
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec }); let containerID;
    try {
      ({ containerID } = await owner.create()); await owner.start();
      assert.match(run('exec', containerID, '/usr/local/bin/turnlink-node', '-e', "console.log(require('/code/package.json').name)"), /.+/);
      assert.throws(() => run('exec', containerID, '/usr/local/bin/turnlink-node', '-e', "require('fs').writeFileSync('/code/forbidden','x')"));
      await owner.stop();
    } finally { owner.close(); if (containerID) try { run('rm', '-f', containerID); } catch {} rmSync(root, { recursive: true, force: true }); }
    const otherRoot = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-code-mismatch-')));
    try {
      const bad = new OpenCodeContainedOwner({ directory: otherRoot, docker, spec: { ...spec, resourceID: randomUUID(), codeVolume: { ...codeVolume, createdAt: 'wrong' } } });
      await assert.rejects(bad.create()); bad.close();
    } finally { rmSync(otherRoot, { recursive: true, force: true }); }
  });

test('volume owner retirement refuses running owner and reconciles exact removed container',
  { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 60000 }, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-retire-')));
    const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
      command: ['sh', '-c', 'test -f /var/lib/turnlink/evidence || echo fixture > /var/lib/turnlink/evidence; sleep 300'], mounts: [], volume: { destination: '/var/lib/turnlink', mode: 'rw' } };
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec }); let containerID, volumeName, intruder, successorID;
    try {
      ({ containerID } = await owner.create()); volumeName = (await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite')).volume.name;
      await owner.start(); assert.equal(run('exec', containerID, 'cat', '/var/lib/turnlink/evidence'), 'fixture');
      run('exec', containerID, 'sh', '-c', 'echo retained > /var/lib/turnlink/evidence');
      await assert.rejects(owner.retireVolumeOwner());
      await owner.stop();
      const retired = await owner.retireVolumeOwner();
      assert.equal(retired.containerID, containerID); assert.equal(retired.volume.name, volumeName);
      assert.deepEqual(await owner.retireVolumeOwner(), retired);
      // Simulate a crash after Docker removed the container but before the
      // final journal write; recovery must observe absence rather than replay.
      const journal = join(root, `${spec.resourceID}.json`), pending = JSON.parse(readFileSync(journal, 'utf8'));
      pending.phase = 'removing'; writeFileSync(journal, JSON.stringify(pending), { mode: 0o600 });
      assert.deepEqual(await owner.retireVolumeOwner(), retired);
      intruder = run('create', '--network=none', '--mount', `type=volume,src=${volumeName},dst=/data`, spec.image, 'sleep', '60');
      await assert.rejects(owner.retireVolumeOwner());
      await assert.rejects(owner.createVolumeSuccessor());
      run('rm', intruder); intruder = undefined;
      const successor = await owner.createVolumeSuccessor(); successorID = successor.containerID;
      assert.notEqual(successor.containerID, containerID); assert.notEqual(successor.operationID, retired.operationID);
      assert.equal(successor.prior.containerID, containerID);
      assert.equal((await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite')).volume.name, volumeName);
      await assert.rejects(owner.createVolumeSuccessor());
      // Simulate losing the create reply after Docker has created the new
      // container. Observation recovers the same ID without another create.
      const lostCreate = JSON.parse(readFileSync(journal, 'utf8')); lostCreate.phase = 'creating'; delete lostCreate.containerID;
      writeFileSync(journal, JSON.stringify(lostCreate), { mode: 0o600 });
      assert.equal((await owner.observe()).containerID, successorID);
      await owner.start(); assert.equal(run('exec', successorID, 'cat', '/var/lib/turnlink/evidence'), 'retained');
      await owner.stop();
    } finally {
      owner.close(); if (intruder) try { run('rm', '-f', intruder); } catch {}
      if (successorID) try { run('rm', '-f', successorID); } catch {}
      if (containerID) try { run('rm', '-f', containerID); } catch {}
      if (volumeName) try { run('volume', 'rm', volumeName); } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  });

test('supervisor SIGKILL leaves exact volume fenced until old container stops and successor is created',
  { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 60000 }, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-killed-owner-')));
    const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
      command: ['sh', '-c', 'test -f /var/lib/turnlink/evidence || echo preserved > /var/lib/turnlink/evidence; sleep 300'],
      mounts: [], volume: { destination: '/var/lib/turnlink', mode: 'rw' } };
    let sourceID, successorID, volumeName, child;
    try {
      const program = `import { OpenCodeContainedOwner } from ${JSON.stringify(new URL('../src/opencode-contained-owner.js', import.meta.url).href)};
const owner = new OpenCodeContainedOwner(JSON.parse(process.argv[1])); const created = await owner.create();
await owner.start(); console.log(JSON.stringify({ ...created, volume: (await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite')).volume.name })); process.stdin.resume();`;
      child = spawn(process.execPath, ['--input-type=module', '-e', program, JSON.stringify({ directory: root, docker, spec })], { stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      const first = await lines.next(); if (first.done) throw new Error('Fixture supervisor did not start');
      const result = JSON.parse(first.value); sourceID = result.containerID; volumeName = result.volume;
      assert.equal(run('exec', sourceID, 'cat', '/var/lib/turnlink/evidence'), 'preserved');
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
      const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
      try {
        assert.equal((await owner.observe()).running, true);
        await assert.rejects(owner.retireVolumeOwner());
        await owner.stop(); await owner.retireVolumeOwner();
        successorID = (await owner.createVolumeSuccessor()).containerID;
        await owner.start(); assert.equal(run('exec', successorID, 'cat', '/var/lib/turnlink/evidence'), 'preserved');
        await owner.stop();
      } finally { owner.close(); }
    } finally {
      child?.kill('SIGKILL'); if (sourceID) try { run('rm', '-f', sourceID); } catch {}
      if (successorID) try { run('rm', '-f', successorID); } catch {}
      if (volumeName) try { run('volume', 'rm', volumeName); } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  });

test('real Docker keeps a setsid descendant inside the exact stopped container and recovers its journal', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 60000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-container-'))), file = join(root, 'input');
  writeFileSync(file, 'evidence');
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const image = run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}');
  const spec = { resourceID: randomUUID(), image, command: ['sh', '-c', 'echo written > /workspace/result; setsid sleep 300 & wait'], mounts: [{ source: file, destination: '/input', mode: 'ro' }, { source: workspace, destination: '/workspace', mode: 'rw' }] };
  let containerID;
  try {
    const program = `import { OpenCodeContainedOwner } from ${JSON.stringify(new URL('../src/opencode-contained-owner.js', import.meta.url).href)};
const input = JSON.parse(process.argv[1]); const owner = new OpenCodeContainedOwner(input);
const created = await owner.create(); await owner.start(); console.log(JSON.stringify(created)); process.stdin.resume();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, JSON.stringify({ directory: root, docker, spec })],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const first = await lines.next();
    if (first.done) throw new Error(`owner exited before start: ${errors}`);
    ({ containerID } = JSON.parse(first.value));
    assert.match(run('top', containerID), /sleep 300/);
    assert.equal(run('exec', containerID, 'cat', '/input'), 'evidence');
    assert.throws(() => run('exec', containerID, 'sh', '-c', 'echo forbidden > /input')); 
    assert.equal(run('exec', containerID, 'cat', '/workspace/result'), 'written');
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await ended;
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
    assert.equal((await owner.observe()).running, true);
    assert.equal((await owner.stop()).status, 'stopped_local');
    assert.equal((await owner.observe()).running, false);
    assert.equal(run('inspect', '--format', '{{.State.Running}}', containerID), 'false');
    renameSync(file, `${file}.old`); writeFileSync(file, 'replacement');
    await assert.rejects(owner.observe());
  } finally {
    if (containerID) { try { run('rm', '-f', containerID); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('configured Docker socket parent cannot be a workspace mount', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 15000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-socket-')));
  try {
    const endpoint = process.env.DOCKER_HOST || run('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
    const source = dirname(new URL(endpoint).pathname);
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec: { resourceID: randomUUID(),
      image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'), command: ['sleep', '30'],
      mounts: [{ source, destination: '/workspace', mode: 'rw' }] } });
    await assert.rejects(owner.create());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('interactive attach relays bytes and lost client cannot replay start', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-attach-')));
  const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
    command: ['cat'], mounts: [] };
  let containerID, attachment;
  try {
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
    ({ containerID } = await owner.create());
    attachment = await owner.startInteractive();
    const lines = createInterface({ input: attachment.child.stdout })[Symbol.asyncIterator]();
    attachment.child.stdin.write('hello contained owner\n');
    assert.equal((await lines.next()).value, 'hello contained owner');
    attachment.child.kill('SIGKILL');
    assert.equal((await attachment.exited).signal, 'SIGKILL');
    const successor = new OpenCodeContainedOwner({ directory: root, docker, spec });
    const state = await successor.observe();
    assert.equal(state.containerID, containerID);
    await assert.rejects(successor.startInteractive());
    await successor.stop();
    assert.equal((await successor.observe()).running, false);
  } finally {
    attachment?.child.kill('SIGKILL');
    if (containerID) { try { run('rm', '-f', containerID); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive attach forwards stdin until normal process exit', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-attach-exit-')));
  const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
    command: ['cat'], mounts: [] };
  let containerID, attachment;
  try {
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
    ({ containerID } = await owner.create());
    attachment = await owner.startInteractive();
    let output = ''; attachment.child.stdout.on('data', chunk => { output += chunk; });
    attachment.child.stdin.end('normal exit\n');
    assert.equal((await attachment.exited).code, 0);
    assert.equal(output, 'normal exit\n');
    assert.equal((await owner.stop()).status, 'stopped_local');
    assert.equal((await owner.observe()).running, false);
  } finally {
    attachment?.child.kill('SIGKILL');
    if (containerID) { try { run('rm', '-f', containerID); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('dedicated local volume is verified and same-name replacement is rejected', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-volume-')));
  const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
    command: ['sh', '-c', 'echo persistent > /var/lib/turnlink/opencode.sqlite; sleep 300'], mounts: [],
    volume: { destination: '/var/lib/turnlink', mode: 'rw' } };
  let containerID, volumeName;
  try {
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
    const created = await owner.create(); containerID = created.containerID; volumeName = `turnlink-opencode-volume-${created.operationID}`;
    const before = await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite');
    assert.equal(before.volume.name, volumeName);
    await assert.rejects(owner.assertDatabaseVolume('/var/lib/turnlink/elsewhere.sqlite'));
    await owner.start();
    assert.equal(run('exec', containerID, 'cat', '/var/lib/turnlink/opencode.sqlite'), 'persistent');
    assert.equal((await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite')).volume.createdAt, before.volume.createdAt);
    await owner.stop();
    const nonce = run('volume', 'inspect', volumeName, '--format', '{{index .Labels "org.turnlink.opencode.volume-nonce"}}');
    run('rm', containerID); containerID = undefined;
    run('volume', 'rm', volumeName);
    await new Promise(resolve => setTimeout(resolve, 1200));
    run('volume', 'create', '--driver', 'local', '--label', `org.turnlink.opencode.volume-nonce=${nonce}`, volumeName);
    await assert.rejects(owner.observe());
  } finally {
    if (containerID) { try { run('rm', '-f', containerID); } catch {} }
    if (volumeName) { try { run('volume', 'rm', '-f', volumeName); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('networkless owner uses only bounded tmpfs and its dedicated volume', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 30000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-tmpfs-')));
  const spec = { resourceID: randomUUID(), image: run('image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'),
    command: ['sh', '-c', 'echo secret > /run/turnlink-secrets/token; echo scratch > /tmp/scratch; sleep 300'],
    mounts: [], volume: { destination: '/var/lib/turnlink', mode: 'rw' }, tmpfs: ['/tmp', '/run/turnlink-secrets'] };
  let containerID, volumeName;
  try {
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec });
    const created = await owner.create(); containerID = created.containerID; volumeName = `turnlink-opencode-volume-${created.operationID}`;
    const container = JSON.parse(run('inspect', containerID))[0];
    assert.deepEqual(container.HostConfig.Tmpfs, { '/run/turnlink-secrets': 'rw,noexec,nosuid,nodev,size=16777216',
      '/tmp': 'rw,noexec,nosuid,nodev,size=16777216' });
    assert.equal(container.Mounts.length, 1); assert.equal(container.Mounts[0].Type, 'volume');
    await owner.start();
    assert.equal(run('exec', containerID, 'cat', '/run/turnlink-secrets/token'), 'secret');
    assert.equal(run('exec', containerID, 'cat', '/tmp/scratch'), 'scratch');
    const mounts = run('exec', containerID, 'cat', '/proc/mounts').split('\n');
    for (const path of spec.tmpfs) {
      const line = mounts.find(value => value.split(' ')[1] === path);
      assert.ok(line, `missing mount ${path}`);
      const flags = line.split(' ')[3].split(',');
      for (const flag of ['rw', 'noexec', 'nosuid', 'nodev']) assert.ok(flags.includes(flag), `${path} missing ${flag}`);
    }
    await owner.stop(); assert.equal((await owner.observe()).running, false);
    for (const invalid of [['/tmp', '/tmp'], ['/other']])
      assert.throws(() => new OpenCodeContainedOwner({ directory: root, docker, spec: { ...spec, resourceID: randomUUID(), tmpfs: invalid } }));
    assert.throws(() => new OpenCodeContainedOwner({ directory: root, docker, spec: { ...spec, resourceID: randomUUID(),
      mounts: [{ source: root, destination: '/run', mode: 'rw' }] } }));
  } finally {
    if (containerID) { try { run('rm', '-f', containerID); } catch {} }
    if (volumeName) { try { run('volume', 'rm', '-f', volumeName); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});
