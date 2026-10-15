import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateTemp } from '../src/storage.js';
import { digest } from '../src/config.js';
import { NativeWorktreeSnapshotReader } from '../src/worktree-snapshot.js';
import { makeOpenCodeSnapshotSource, makeCodexSnapshotSource } from '../src/native-snapshot-source.js';

function fixture(t, harness = 'opencode') {
  const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-snapshot-'))), project = join(root, 'project'), destination = join(root, 'worktree');
  const home = join(root, 'home'), globalDirectory = join(home, harness === 'opencode' ? '.config/opencode' : '.codex');
  mkdirSync(project); mkdirSync(globalDirectory, { recursive: true });
  writeFileSync(join(project, 'AGENTS.md'), 'Project instructions.\n'); writeFileSync(join(globalDirectory, 'AGENTS.md'), 'Global instructions.\n');
  execFileSync('git', ['init', project], { stdio: 'ignore' }); execFileSync('git', ['-C', project, 'add', 'AGENTS.md']);
  execFileSync('git', ['-C', project, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'worktree', 'add', '--detach', destination], { stdio: 'ignore' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const observation = { harness, sessionID: 'a', directory: project, idle: true, blocked: false, revision: 0,
    resolvedConfigurationDigest: digest('native config'),
    authority: { selectedAgent: 'plan', model: { provider: 'fixture', model: 'test' }, permissions: [{ action: 'edit', resource: '*', effect: 'deny' }],
      tools: [{ name: 'read', input: {} }], instructionEntriesDigest: digest('native retained instruction entries'),
      ...(harness === 'codex' ? { sandbox: { type: 'readOnly' }, approvalPolicy: 'never' } : {}) } };
  const options = { harness, sessionID: 'a', native: async () => structuredClone(observation), home, globalDirectory, environment: {} };
  return { root, project, destination, home, globalDirectory, observation, options,
    reader: extra => new NativeWorktreeSnapshotReader({ ...options, ...extra }) };
}

test('offline native snapshots preserve identity, inventory ancestor/global/project guidance, and never authorize movement', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'opencode.jsonc'), '{ "permissions": [{"action":"edit","resource":"*","effect":"deny"}], }');
  writeFileSync(join(f.destination, 'AGENTS.md'), 'Different destination guidance approved separately.\n');
  const pair = await f.reader().inspectPair(f.destination);
  assert.equal(pair.source.agentId, 'opencode:a'); assert.equal(pair.source.projectID, pair.destination.projectID);
  assert.equal(pair.source.authorityDigest, pair.destination.authorityDigest);
  assert.notEqual(pair.source.configurationDigest, pair.destination.configurationDigest);
  assert.equal(pair.executionEligible, false); assert.equal(pair.destinationMode, 'offline');
  assert.ok(pair.records.some(r => r.path === join(f.root, 'opencode.jsonc') && r.present));
  assert.ok(pair.instructionCandidates.source.includes(join(f.globalDirectory, 'AGENTS.md')));
  assert.ok(pair.instructionCandidates.destination.includes(join(f.destination, 'AGENTS.md')));
  assert.ok(pair.issues.includes('NATIVE_EXCLUSION_UNVERIFIED'));
  const unspecified = await f.reader({ environment: undefined }).inspectPair(f.destination);
  assert.ok(unspecified.issues.includes('RUNTIME_ENVIRONMENT_UNVERIFIED'));
});

test('credential-shaped config values, provider headers, instruction contents and native tool text are never returned', async t => {
  const f = fixture(t), secret = 'fixture-secret-never-publish';
  writeFileSync(join(f.globalDirectory, 'opencode.json'), JSON.stringify({ providers: { fixture: { settings: { headers: { Authorization: secret } } } } }));
  writeFileSync(join(f.destination, 'AGENTS.md'), `Confidential instruction ${secret}`);
  f.observation.authority.tools[0].description = secret;
  const output = JSON.stringify(await f.reader().inspectPair(f.destination));
  assert.ok(!output.includes(secret)); assert.ok(!output.includes('Authorization')); assert.ok(!output.includes('Confidential instruction'));
});

test('introduced destination permissions, plugins, substitution, remote instructions and unknown fields cannot pass the native gate', async t => {
  const f = fixture(t);
  writeFileSync(join(f.destination, 'opencode.json'), JSON.stringify({ permissions: [{ action: 'edit', resource: '/original/**', effect: 'allow' }],
    plugins: ['never-execute-this-package'], instructions: ['https://example.invalid/private', 'rules/*.md'],
    model: '{env:SECRET_MODEL}', future_privilege_override: true }));
  const pair = await f.reader().inspectPair(f.destination);
  assert.notEqual(pair.source.authorityDigest, pair.destination.authorityDigest);
  for (const issue of ['PATH_DEPENDENT_PERMISSION_RULE', 'DYNAMIC_OR_UNRESOLVED_CONFIGURATION', 'UNRESOLVED_CONFIGURATION_SUBSTITUTION',
    'REMOTE_OR_GLOB_INSTRUCTION_UNRESOLVED', 'UNKNOWN_CONFIGURATION_FIELD_REQUIRE_NATIVE_RESOLUTION']) assert.ok(pair.issues.includes(issue));
  assert.equal(pair.executionEligible, false);
});

test('snapshot discovery does not execute destination plugin code', async t => {
  const f = fixture(t), marker = join(f.root, 'executed.marker');
  mkdirSync(join(f.destination, '.opencode/plugins'), { recursive: true });
  writeFileSync(join(f.destination, '.opencode/plugins/evil.js'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  const pair = await f.reader().inspectPair(f.destination);
  assert.ok(pair.issues.includes('DIRECTORY_DEFINITIONS_REQUIRE_NATIVE_RESOLUTION'));
  assert.ok(!pair.records.some(r => r.path === marker));
  const { existsSync } = await import('node:fs'); assert.equal(existsSync(marker), false);
});

test('Codex override priority is represented without pretending project-trust or tool inventory has been resolved', async t => {
  const f = fixture(t, 'codex');
  writeFileSync(join(f.destination, 'AGENTS.override.md'), 'Override destination guide.');
  mkdirSync(join(f.destination, '.codex')); writeFileSync(join(f.destination, '.codex/config.toml'), 'sandbox_mode = "danger-full-access"\n');
  const pair = await f.reader().inspectPair(f.destination);
  assert.ok(pair.instructionCandidates.destination.includes(join(f.destination, 'AGENTS.override.md')));
  assert.ok(!pair.instructionCandidates.destination.includes(join(f.destination, 'AGENTS.md')));
  assert.ok(pair.issues.includes('PROJECT_CONFIG_TRUST_REQUIRE_NATIVE_RESOLUTION'));
  assert.ok(pair.issues.includes('CODEX_REQUIREMENTS_AND_TOOL_INVENTORY_REQUIRE_NATIVE_RESOLUTION'));
});

test('missing files are inventoried and additions, directory changes and native activity races invalidate the snapshot', async t => {
  for (const change of ['file', 'directory', 'activity']) await t.test(change, async t => {
    const f = fixture(t); let calls = 0;
    const native = async () => {
      if (++calls === 2) {
        if (change === 'file') writeFileSync(join(f.destination, 'opencode.json'), '{"model":"changed"}');
        if (change === 'directory') mkdirSync(join(f.destination, '.opencode/plugins'), { recursive: true });
        if (change === 'activity') f.observation.revision++;
      }
      return structuredClone(f.observation);
    };
    await assert.rejects(f.reader({ native }).inspectPair(f.destination), /SNAPSHOT_SOURCE_CHANGED|NATIVE_SNAPSHOT_CHANGED/);
  });
});

test('symlink config paths, malformed configuration, oversized files and foreign worktrees fail closed', async t => {
  const f = fixture(t);
  const secretFile = join(f.root, 'not-config'); writeFileSync(secretFile, 'private');
  symlinkSync(secretFile, join(f.destination, 'opencode.json'));
  await assert.rejects(f.reader().inspectPair(f.destination), /SNAPSHOT_SYMLINK_REFUSED/);
  rmSync(join(f.destination, 'opencode.json')); writeFileSync(join(f.destination, 'opencode.json'), '{ "broken": ');
  await assert.rejects(f.reader().inspectPair(f.destination), /SNAPSHOT_CONFIG_INVALID/);
  writeFileSync(join(f.destination, 'opencode.json'), '{"__proto__":{"permissions":[{"effect":"allow"}]}}');
  await assert.rejects(f.reader().inspectPair(f.destination), /SNAPSHOT_CONFIG_INVALID/);
  writeFileSync(join(f.destination, 'opencode.json'), ' '.repeat(2048));
  await assert.rejects(f.reader({ limits: { fileBytes: 1024 } }).inspectPair(f.destination), /SNAPSHOT_BUDGET_EXCEEDED/);
  const foreign = join(f.root, 'foreign'); mkdirSync(foreign); execFileSync('git', ['init', foreign], { stdio: 'ignore' });
  await assert.rejects(f.reader().inspectPair(foreign), /WORKTREE_PROJECT_MISMATCH/);
});

test('native failures and identity substitution never echo exception bodies or credential values', async t => {
  const f = fixture(t), secret = 'secret-provider-body';
  await assert.rejects(f.reader({ native: async () => { throw new Error(secret); } }).inspectPair(f.destination), error =>
    error.message === 'NATIVE_SNAPSHOT_UNAVAILABLE' && !JSON.stringify(error).includes(secret));
  await assert.rejects(f.reader({ native: async () => ({ ...f.observation, sessionID: 'another-session' }) }).inspectPair(f.destination), /TRANSITION_IDENTITY_MISMATCH/);
});

test('OpenCode source collector binds native agent/session permissions, tools and instruction entries without guessing idle', async () => {
  const session = { id: 'a', agent: 'plan', model: { providerID: 'fixture', id: 'test' }, location: { directory: '/source' }, permissions: [{ action: 'edit', effect: 'deny', resource: '*' }] };
  const options = { sessionID: 'a', readSession: async () => session, readAgent: async () => ({ id: 'plan', permissions: [] }),
    readTools: async () => [{ id: 'read' }], readInstructions: async () => [{ key: 'global', value: 'private instructions' }],
    readConfiguration: async () => [{ type: 'document', info: {} }], readActivity: async () => ({ idle: true, blocked: false, revision: 10 }) };
  const value = await makeOpenCodeSnapshotSource(options)();
  assert.equal(value.sessionID, 'a'); assert.deepEqual(value.authority.permissions.session, session.permissions);
  assert.ok(!JSON.stringify(value).includes('private instructions'));
  await assert.rejects(makeOpenCodeSnapshotSource({ ...options, readActivity: undefined })(), /NATIVE_ACTIVITY_REQUIRED/);
});

test('Codex source collector preserves actual sandbox and approval policy; source changes invalidate collection', async () => {
  const thread = { thread: { id: 'a' }, cwd: '/source', model: 'fixture', modelProvider: 'fixture', sandbox: { type: 'readOnly' }, approvalPolicy: 'never' };
  const options = { threadID: 'a', readThread: async () => thread, readTools: async () => [], readConfiguration: async () => ({ layers: [] }),
    readInstructions: async () => ({ sources: ['/source/AGENTS.md'] }), readActivity: async () => ({ idle: true, blocked: false, revision: 1 }) };
  const value = await makeCodexSnapshotSource(options)();
  assert.deepEqual(value.authority.sandbox, thread.sandbox); assert.equal(value.authority.approvalPolicy, 'never');
  let revision = 0;
  await assert.rejects(makeCodexSnapshotSource({ ...options, readActivity: async () => ({ idle: true, blocked: false, revision: revision++ }) })(), /NATIVE_SNAPSHOT_CHANGED/);
});

test('native configuration key order is normalized but ordered permissions remain significant', async () => {
  const thread = { thread: { id: 'a' }, cwd: '/source', model: 'fixture', modelProvider: 'fixture', sandbox: { type: 'readOnly' }, approvalPolicy: 'never' };
  let reverse = false, reverseRules = false;
  const rules = [{ effect: 'deny', resource: '*' }, { effect: 'allow', resource: '*' }];
  const options = { threadID: 'a', readThread: async () => thread, readTools: async () => [],
    readConfiguration: async () => ({ ...(reverse ? { sandbox: 'read-only', nested: { b: 2, a: 1 } } : { nested: { a: 1, b: 2 }, sandbox: 'read-only' }),
      permissions: reverseRules ? [...rules].reverse() : rules }),
    readInstructions: async () => [], readActivity: async () => ({ idle: true, blocked: false, revision: 1 }) };
  const source = makeCodexSnapshotSource(options), first = await source(); reverse = true;
  assert.equal((await source()).resolvedConfigurationDigest, first.resolvedConfigurationDigest);
  reverseRules = true; assert.notEqual((await source()).resolvedConfigurationDigest, first.resolvedConfigurationDigest);
});

test('OpenCode default model must be resolved by a native API, never guessed from an absent session override', async () => {
  const session = { id: 'a', agent: 'plan', location: { directory: '/source' } };
  const options = { sessionID: 'a', readSession: async () => session, readAgent: async () => ({ id: 'plan', permissions: [] }), readTools: async () => [],
    readConfiguration: async () => [], readInstructions: async () => [], readActivity: async () => ({ idle: true, blocked: false, revision: 1 }) };
  await assert.rejects(makeOpenCodeSnapshotSource(options)(), /NATIVE_MODEL_REQUIRED/);
  const value = await makeOpenCodeSnapshotSource({ ...options, readResolvedModel: async () => ({ providerID: 'fixture', id: 'native-default' }) })();
  assert.equal(value.authority.model.id, 'native-default');
});
