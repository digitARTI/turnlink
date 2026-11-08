import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, renameSync, existsSync, realpathSync, linkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateTemp } from '../src/storage.js';
import { WorktreeLifecycle } from '../src/worktree-lifecycle.js';

function fixture(t) {
  const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-lifecycle-'))), repository = join(root, 'repo'); mkdirSync(repository);
  const git = (args, cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(repository, 'tracked.txt'), 'original\n'); writeFileSync(join(repository, '.gitignore'), 'ignored\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  const taskID = randomUUID(), approvals = new Map(), authorizations = [], calls = [];
  let current = { claimant: 'opencode:a', claimGeneration: 1, status: 'claimed' }, time = 1000, crash = false, onAuthorize;
  const options = { repository, directory: join(root, 'state'), worktreeRoot: join(root, 'trees'), agentId: 'opencode:a', enabled: true, now: () => time,
    port: { exclusive: async fn => fn(), claim: async () => current,
      authorize: async request => { authorizations.push(request); await onAuthorize?.(); return approvals.get(request.previewID) === request.digest; } },
    afterEffect: record => { calls.push(record.kind); if (crash) throw new Error('simulated lost Git result'); } };
  const make = (extra = {}) => new WorktreeLifecycle({ ...options, ...extra });
  const lifecycle = make();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repository, lifecycle, make, git, taskID, approvals, calls, authorizations,
    preview: () => lifecycle.previewCreate(taskID, 1), approve: p => { approvals.set(p.id, p.digest); },
    claim: c => { current = c; }, time: n => { time = n; }, crash: value => { crash = value; }, authorize: fn => { onAuthorize = fn; } };
}

test('managed host lifecycle is default-off and requires trusted exclusion/claim/approval ports', t => {
  const f = fixture(t);
  assert.throws(() => f.make({ enabled: false }), /MANAGED_WORKTREES_DISABLED/);
  assert.throws(() => f.make({ port: {} }), /WORKTREE_HOST_PORT_REQUIRED/);
  assert.throws(() => f.make({ worktreeRoot: 'relative' }), /ABSOLUTE_WORKTREE_PATH_REQUIRED/);
});
test('real Git creation pins revision, requires exact approval, uses detached tree and removes only by a separate preview', async t => {
  const f = fixture(t), preview = await f.preview();
  assert.equal(existsSync(preview.destination), false);
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_APPROVAL_REQUIRED/);
  f.approve(preview); const created = await f.lifecycle.create(preview.id);
  assert.equal(created.phase, 'created'); assert.equal(readFileSync(join(created.destination, 'tracked.txt'), 'utf8'), 'original\n');
  assert.equal(f.git(['rev-parse', 'HEAD'], created.destination), preview.revision);
  assert.equal(f.git(['branch', '--show-current'], created.destination), '');
  await f.lifecycle.create(preview.id); assert.deepEqual(f.calls, ['create']);
  const removal = await f.lifecycle.previewRemove(created.id);
  await assert.rejects(f.lifecycle.remove(removal.id), /WORKTREE_APPROVAL_REQUIRED/);
  f.approve(removal); const removed = await f.lifecycle.remove(removal.id);
  assert.equal(removed.phase, 'removed'); assert.equal(existsSync(created.destination), false);
  await f.lifecycle.remove(removal.id); assert.deepEqual(f.calls, ['create', 'remove']);
  assert.equal(f.git(['rev-parse', 'HEAD']), preview.revision, 'original checkout remains unchanged');
});
test('claim generation, expiry and claim changes during approval fence actual filesystem effects', async t => {
  for (const kind of ['generation', 'expiry', 'during-approval']) await t.test(kind, async t => {
    const f = fixture(t), preview = await f.preview(); f.approve(preview);
    if (kind === 'generation') f.claim({ claimant: 'opencode:a', claimGeneration: 2, status: 'claimed' });
    if (kind === 'expiry') f.time(preview.expiresAt);
    if (kind === 'during-approval') f.authorize(() => f.claim({ claimant: 'opencode:b', claimGeneration: 1, status: 'claimed' }));
    await assert.rejects(f.lifecycle.create(preview.id), /STALE_(TASK_CLAIM|WORKTREE_PREVIEW)/);
    assert.equal(existsSync(preview.destination), false); assert.deepEqual(f.calls, []);
  });
});
test('branch advances after preview cannot change the approved checkout revision', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview);
  writeFileSync(join(f.repository, 'tracked.txt'), 'next\n'); f.git(['commit', '-am', 'advance']);
  const created = await f.lifecycle.create(preview.id);
  assert.equal(readFileSync(join(created.destination, 'tracked.txt'), 'utf8'), 'original\n');
  assert.notEqual(f.git(['rev-parse', 'HEAD']), created.revision);
});
test('lost creation/removal results reconcile from exact observed trees after restart without replay', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); f.crash(true);
  await assert.rejects(f.lifecycle.create(preview.id), /simulated lost/);
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_RECOVERY_REQUIRED/);
  const restarted = f.make(); let recovered = await restarted.recover(); assert.equal(recovered[0].phase, 'created');
  assert.deepEqual(f.calls, ['create']);
  const removal = await restarted.previewRemove(preview.id); f.approve(removal);
  await assert.rejects(restarted.remove(removal.id), /simulated lost/);
  recovered = await f.make().recover(); assert.equal(recovered.find(r => r.id === removal.id).phase, 'removed');
  assert.deepEqual(f.calls, ['create', 'remove']);
});
test('dirty, untracked, ignored, trust-bit and newly committed work cannot be cleaned even with approval', async t => {
  for (const kind of ['tracked', 'untracked', 'ignored', 'assume', 'skip', 'committed']) await t.test(kind, async t => {
    const f = fixture(t), preview = await f.preview(); f.approve(preview); const created = await f.lifecycle.create(preview.id);
    const removal = await f.lifecycle.previewRemove(created.id); f.approve(removal);
    if (kind === 'tracked') writeFileSync(join(created.destination, 'tracked.txt'), 'user edit');
    if (kind === 'untracked') writeFileSync(join(created.destination, 'new.txt'), 'user data');
    if (kind === 'ignored') writeFileSync(join(created.destination, 'ignored'), 'user data');
    if (kind === 'assume' || kind === 'skip') {
      f.git(['update-index', kind === 'assume' ? '--assume-unchanged' : '--skip-worktree', 'tracked.txt'], created.destination);
      writeFileSync(join(created.destination, 'tracked.txt'), 'hidden user edit');
    }
    if (kind === 'committed') { writeFileSync(join(created.destination, 'tracked.txt'), 'new commit'); f.git(['commit', '-am', 'user work'], created.destination); }
    await assert.rejects(f.lifecycle.remove(removal.id), /DIRTY_WORKTREE|WORKTREE_RESOURCE_CHANGED|WORKTREE_INDEX_TRUST_UNSUPPORTED/);
    assert.equal(existsSync(created.destination), true); assert.deepEqual(f.calls, ['create']);
  });
});
test('incomplete/mutated creation remains quarantined; recovery never deletes or replays', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); f.crash(true);
  await assert.rejects(f.lifecycle.create(preview.id));
  writeFileSync(join(preview.destination, 'tracked.txt'), 'after crash user edit');
  const recovered = await f.make().recover(); assert.equal(recovered[0].phase, 'uncertain');
  await assert.rejects(f.lifecycle.previewCreate(f.taskID, 1), /WORKTREE_LIFECYCLE_UNRESOLVED/);
  assert.equal(readFileSync(join(preview.destination, 'tracked.txt'), 'utf8'), 'after crash user edit');
  assert.deepEqual(f.calls, ['create']);
});
test('foreign agent, locked tree and replaced directories cannot be removed or silently adopted', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); await f.lifecycle.create(preview.id);
  await assert.rejects(f.make({ agentId: 'opencode:b' }).previewRemove(preview.id), /MANAGED_WORKTREE_NOT_FOUND/);
  f.git(['worktree', 'lock', preview.destination]); await assert.rejects(f.lifecycle.previewRemove(preview.id), /WORKTREE_RESOURCE_CHANGED/);
  f.git(['worktree', 'unlock', preview.destination]);
  renameSync(preview.destination, `${preview.destination}-original`); mkdirSync(preview.destination);
  await assert.rejects(f.lifecycle.previewRemove(preview.id), /WORKTREE_DIRECTORY_REPLACED/);
  assert.equal(existsSync(`${preview.destination}-original/tracked.txt`), true);
});
test('symlink managed roots and destination aliases are refused without modifying their target', async t => {
  const f = fixture(t), alias = join(f.root, 'alias'); symlinkSync(join(f.root, 'trees'), alias, 'dir');
  assert.throws(() => f.make({ worktreeRoot: alias }), /WORKTREE_SYMLINK_PATH/);
  const preview = await f.preview(); f.approve(preview);
  symlinkSync(f.repository, join(f.root, 'trees', preview.id), 'dir');
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_SYMLINK_PATH/);
  assert.equal(readFileSync(join(f.repository, 'tracked.txt'), 'utf8'), 'original\n');
});
test('checkout filters are rejected and repository post-checkout hooks are not executed', async t => {
  const f = fixture(t), marker = join(f.root, 'hook-ran');
  writeFileSync(join(f.repository, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  f.git(['config', 'filter.secret.smudge', 'false']);
  const preview = await f.preview(); f.approve(preview);
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_CHECKOUT_FILTER_UNSUPPORTED/);
  assert.equal(existsSync(preview.destination), false);
  f.git(['config', '--remove-section', 'filter.secret']); await f.lifecycle.create(preview.id);
  assert.equal(existsSync(marker), false);
});
test('repository writer excludes concurrent instances across an asynchronous approval gap', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); const second = f.make();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.authorize(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  const pending = f.lifecycle.create(preview.id); await waiting;
  await assert.rejects(second.previewCreate(f.taskID, 1));
  f.authorize(undefined); release(); await pending;
  assert.deepEqual(f.calls, ['create']);
});

test('actual process exit after Git effect leaves durable evidence and restart only observes, never repeats', async t => {
  const f = fixture(t), preview = await f.preview();
  const crash = (op, id) => {
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/worktree-lifecycle-crash.js', import.meta.url)),
      f.repository, join(f.root, 'state'), join(f.root, 'trees'), f.taskID, op, id], { stdio: ['ignore', 'pipe', 'pipe'] }),
    error => (error.signal === 'SIGKILL' || (process.platform === 'win32' && error.status !== 0)) && String(error.stderr).includes('FIXTURE_AFTER_EFFECT'));
  };
  crash('create', preview.id);
  // proper-lockfile conservatively holds a crashed writer for its stale timeout.
  // Recover in the same process test only after removing the exact test-owned
  // stale lock directory, never by enabling a production force unlock API.
  const lock = f.lifecycle.lock + '.lock'; rmSync(lock, { recursive: true });
  let records = await f.make().recover(); assert.equal(records.find(r => r.id === preview.id).phase, 'created');
  const next = f.make(), removal = await next.previewRemove(preview.id);
  crash('remove', removal.id); rmSync(lock, { recursive: true });
  records = await f.make().recover(); assert.equal(records.find(r => r.id === removal.id).phase, 'removed');
  assert.equal(existsSync(preview.destination), false); assert.deepEqual(f.calls, []);
});

test('last-moment checkout configuration drift quarantines the reservation before Git admission', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); let checks = 0;
  f.authorize(() => { if (++checks === 2) f.git(['config', 'filter.untrusted.smudge', 'false']); });
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_CHECKOUT_FILTER_UNSUPPORTED/);
  assert.deepEqual(f.calls, []);
  const recovered = await f.make().recover(); assert.equal(recovered[0].phase, 'uncertain');
  assert.equal(existsSync(preview.destination), true, 'reserved directory is preserved for inspection, never force deleted');
});

test('cleanup cannot destroy a tree while task execution or evidence review remains unresolved', async t => {
  for (const status of ['running', 'uncertain', 'review']) await t.test(status, async t => {
    const f = fixture(t), preview = await f.preview(); f.approve(preview); await f.lifecycle.create(preview.id);
    const removal = await f.lifecycle.previewRemove(preview.id); f.approve(removal);
    f.claim({ claimant: 'opencode:a', claimGeneration: 1, status });
    await assert.rejects(f.lifecycle.remove(removal.id), /STALE_TASK_CLAIM/);
    assert.equal(existsSync(preview.destination), true); assert.deepEqual(f.calls, ['create']);
  });
});

test('hard-linked journal snapshots are rejected before reading or rewriting shared evidence', async t => {
  const f = fixture(t); await f.preview();
  const alias = join(f.root, 'journal-alias'); linkSync(f.lifecycle.file, alias);
  const before = readFileSync(alias, 'utf8');
  assert.throws(() => f.make(), /WORKTREE_JOURNAL_LINK_REFUSED/);
  await assert.rejects(f.lifecycle.previewCreate(f.taskID, 1), /WORKTREE_JOURNAL_LINK_REFUSED/);
  assert.equal(readFileSync(alias, 'utf8'), before);
});

test('partial-clone configuration is refused rather than invoking a configured transport/credential helper during checkout', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview);
  f.git(['config', 'remote.untrusted.promisor', 'true']);
  f.git(['config', 'remote.untrusted.url', 'ext::untrusted-helper']);
  await assert.rejects(f.lifecycle.create(preview.id), /WORKTREE_PARTIAL_CLONE_UNSUPPORTED/);
  assert.equal(existsSync(preview.destination), false); assert.deepEqual(f.calls, []);
});

test('cleanup inspects destination worktree-specific filters and never invokes their clean command', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview); await f.lifecycle.create(preview.id);
  f.git(['config', 'extensions.worktreeConfig', 'true']);
  f.git(['config', '--worktree', 'filter.private.clean', 'false'], preview.destination);
  await assert.rejects(f.lifecycle.previewRemove(preview.id), /WORKTREE_CHECKOUT_FILTER_UNSUPPORTED/);
  assert.equal(existsSync(preview.destination), true); assert.deepEqual(f.calls, ['create']);
});

test('repository-specific protocol overrides cannot enable a remote helper or credential transport in the isolated Git port', t => {
  const f = fixture(t), marker = join(f.root, 'helper-ran'), helper = join(f.root, 'helper');
  writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
  f.git(['config', 'protocol.ext.allow', 'always']);
  assert.throws(() => f.lifecycle.git(['ls-remote', `ext::${helper}`]), /WORKTREE_GIT_OPERATION_FAILED/);
  assert.equal(existsSync(marker), false);
});

test('replacement refs cannot change the approved commit tree during checkout', async t => {
  const f = fixture(t), preview = await f.preview(); f.approve(preview);
  writeFileSync(join(f.repository, 'tracked.txt'), 'replacement tree\n'); f.git(['commit', '-am', 'replacement']);
  const replacement = f.git(['rev-parse', 'HEAD']); f.git(['replace', preview.revision, replacement]);
  const created = await f.lifecycle.create(preview.id);
  assert.equal(readFileSync(join(created.destination, 'tracked.txt'), 'utf8'), 'original\n');
});
