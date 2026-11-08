import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { devNull } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentID } from './protocol.js';
import { digest } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { requireControl as check } from './control/policy.js';
import { LifecycleRecord, lifecycleDigest } from './control/worktree-lifecycle-contracts.js';
import { HostCoordination } from './worktree-host-contracts.js';

const uuid = z.string().uuid(), integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Record = LifecycleRecord.extend({ coordination: HostCoordination.optional() });
const Journal = z.strictObject({ version: z.union([z.literal(1), z.literal(2)]), records: z.array(Record).max(256) })
  .refine(v => v.version === 2 || v.records.every(r => !r.coordination));
const present = path => { try { return lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
const identityPart = value => typeof value === 'bigint' ? value : typeof value === 'string' && /^[0-9]+$/.test(value) ? BigInt(value) :
  Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
const same = (a, b) => !!a && !!b && identityPart(a.dev) !== undefined && identityPart(a.ino) !== undefined &&
  identityPart(a.dev) === identityPart(b.dev) && identityPart(a.ino) === identityPart(b.ino);
const serialIdentity = path => {
  const value = lstatSync(path, { bigint: true });
  const encode = item => item <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(item) : item.toString();
  return { dev: encode(value.dev), ino: encode(value.ino) };
};
const resolvedDirectory = path => { const value = lstatSync(realpathSync(path), { bigint: true }); return value.isDirectory() ? value : undefined; };
const sameGitPath = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (process.platform !== 'win32') return a === b;
  if (win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()) return true;
  // Git can expand a Windows 8.3 alias that Node retained in the input path.
  // Resolve both existing directories and compare their filesystem identities.
  try { return same(resolvedDirectory(a), resolvedDirectory(b)); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
// Git for Windows understands the Windows device name, but rejects Node's
// \\.\nul namespace spelling when reading GIT_CONFIG_GLOBAL.
const gitNull = process.platform === 'win32' ? 'NUL' : devNull;

// Internal participant-host port, NOT a model/browser API or a native movement
// capability. Trusted callers supply approval/claim checks and native exclusion.
// No branch deletion, force removal, pruning, session movement or permissions edits.
export class WorktreeLifecycle {
  constructor({ repository, directory, worktreeRoot, agentId, port, enabled = false, now = Date.now, afterEffect = () => {} }) {
    check(enabled === true, 'MANAGED_WORKTREES_DISABLED'); AgentID.parse(agentId);
    check(typeof port?.exclusive === 'function' && typeof port?.claim === 'function' && typeof port?.authorize === 'function', 'WORKTREE_HOST_PORT_REQUIRED');
    for (const value of [repository, directory, worktreeRoot]) check(isAbsolute(value), 'ABSOLUTE_WORKTREE_PATH_REQUIRED');
    this.repository = realpathSync(repository); this.agentId = agentId; this.port = port; this.now = now; this.afterEffect = afterEffect;
    // Reject symlink aliases before creating any managed state beneath them.
    for (const value of [directory, worktreeRoot]) {
      check(realpathSync(dirname(value)) === dirname(value), 'WORKTREE_SYMLINK_PATH');
      if (present(value)) check(!lstatSync(value).isSymbolicLink(), 'WORKTREE_SYMLINK_PATH');
      privateDirectory(value); check(realpathSync(value) === value, 'WORKTREE_SYMLINK_PATH');
    }
    this.root = worktreeRoot; this.stateRoot = directory;
    check(same(resolvedDirectory(this.git(['rev-parse', '--show-toplevel'])), resolvedDirectory(this.repository)), 'WORKTREE_REPOSITORY_ROOT_REQUIRED');
    this.common = realpathSync(this.git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
    this.commonIdentity = resolvedDirectory(this.common);
    // One journal/writer per repository and host directory, shared across agents.
    const name = digest(this.common);
    this.file = join(directory, `${name}.worktrees.json`); this.lock = join(directory, `${name}.worktree-writer`);
    this.reload();
  }
  git(args, cwd = this.repository) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitNull, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_ALLOW_PROTOCOL: '' });
    try {
      return execFileSync('git', ['-c', `core.hooksPath=${gitNull}`, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        '-c', 'protocol.allow=never', '-c', 'submodule.recurse=false', ...args],
        { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
    } catch { throw new Error('WORKTREE_GIT_OPERATION_FAILED'); } // Never leak config/filter output or native error bodies.
  }
  reload() {
    try {
      check(lstatSync(this.file).nlink === 1, 'WORKTREE_JOURNAL_LINK_REFUSED');
      this.records = Journal.parse(JSON.parse(readPrivate(this.file, 2 * 1024 * 1024))).records;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.records = []; }
    check(new Set(this.records.map(r => r.id)).size === this.records.length, 'INVALID_WORKTREE_JOURNAL');
    for (const record of this.records) {
      check(record.repository === this.repository && record.common === this.common &&
        record.destination === join(this.root, record.resourceID, 'tree'), 'WORKTREE_JOURNAL_SCOPE_MISMATCH');
      if (record.kind === 'create') check(record.id === record.resourceID, 'INVALID_WORKTREE_JOURNAL');
      else check(this.records.some(r => r.id === record.resourceID && r.kind === 'create' && r.agentId === record.agentId &&
        r.taskID === record.taskID && r.claimGeneration === record.claimGeneration), 'INVALID_WORKTREE_JOURNAL');
      check(['preview', 'uncertain', 'failed'].includes(record.phase) || !!record.directory, 'INVALID_WORKTREE_JOURNAL');
      check(!record.coordination || this.port.coordinated === true, 'WORKTREE_HOST_BRIDGE_REQUIRED');
      if (record.coordination) {
        const c = record.coordination;
        if (c.manualAttestation) check(c.manualAttestation.previewID === record.id &&
          c.manualAttestation.digest === this.previewDigest(record) && c.manualAttestation.confirmedAt >= record.createdAt &&
          c.manualAttestation.confirmedAt < record.expiresAt, 'INVALID_WORKTREE_JOURNAL');
        check(!['inflight', 'created', 'removed', 'uncertain'].includes(record.phase) || c.beginState === 'admitted', 'INVALID_WORKTREE_JOURNAL');
        check(!c.publicationRefused || record.phase === 'failed', 'INVALID_WORKTREE_JOURNAL');
        for (const s of c.settlements) {
          check(record.kind === 'create' ? s.outcome !== 'removed' : s.outcome !== 'created', 'INVALID_WORKTREE_JOURNAL');
          check(s.outcome !== 'created' || same(s.directory, record.directory), 'INVALID_WORKTREE_JOURNAL');
          check(s.outcome === record.phase || (s.outcome === 'uncertain' && ['created', 'removed'].includes(record.phase)), 'INVALID_WORKTREE_JOURNAL');
        }
      }
      check(record.kind === 'create' ? record.phase !== 'removed' : !['reserved', 'created'].includes(record.phase), 'INVALID_WORKTREE_JOURNAL');
      if (record.kind === 'remove') check(!!record.directory, 'INVALID_WORKTREE_JOURNAL');
    }
  }
  put(record) {
    check(this.locked && !this.fault, 'WORKTREE_JOURNAL_UNAVAILABLE'); Record.parse(record);
    const records = this.records.filter(r => r.id !== record.id).concat(record);
    Journal.parse({ version: 2, records });
    atomicWrite(this.file, JSON.stringify({ version: 2, records })); this.records = records; return structuredClone(record);
  }
  async exclusive(fn) {
    check(!this.locked && !this.fault, 'WORKTREE_JOURNAL_UNAVAILABLE');
    const release = acquireStore(this.lock, () => { this.fault = true; }); this.locked = true;
    try { this.reload(); this.paths(); return await this.port.exclusive(fn); }
    finally { this.locked = false; release(); }
  }
  paths(record) {
    check(realpathSync(this.root) === this.root && realpathSync(this.stateRoot) === this.stateRoot &&
      realpathSync(this.repository) === this.repository, 'WORKTREE_SYMLINK_PATH');
    check(same(resolvedDirectory(this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'])), this.commonIdentity), 'WORKTREE_REPOSITORY_CHANGED');
    if (record) {
      check(record.destination === join(this.root, record.resourceID, 'tree'), 'WORKTREE_JOURNAL_SCOPE_MISMATCH');
      const parent = dirname(record.destination);
      if (present(parent)) check(realpathSync(parent) === parent && !lstatSync(parent).isSymbolicLink(), 'WORKTREE_SYMLINK_PATH');
      const stat = present(record.destination);
      if (stat) check(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(record.destination) === record.destination, 'WORKTREE_SYMLINK_PATH');
      if (record.directory && stat) check(same(record.directory, serialIdentity(record.destination)), 'WORKTREE_DIRECTORY_REPLACED');
    }
  }
  async claim(record, cleanup = false) {
    const current = await this.port.claim(record.taskID);
    check(current?.claimant === this.agentId && current.claimGeneration === record.claimGeneration &&
      (cleanup ? ['claimed', 'completed', 'cancelled'].includes(current.status) : current.status === 'claimed'), 'STALE_TASK_CLAIM');
  }
  unresolved(except) {
    check(!this.records.some(r => r.id !== except && ['reserved', 'inflight', 'uncertain'].includes(r.phase)), 'WORKTREE_LIFECYCLE_UNRESOLVED');
  }
  async authorized(record, cleanup = false) {
    check(!this.fault && record.agentId === this.agentId && record.expiresAt > this.now() && this.now() >= record.createdAt, 'STALE_WORKTREE_PREVIEW');
    await this.claim(record, cleanup);
    // Exact immutable preview digest; no caller-selected "approved" boolean.
    check(await this.port.authorize({ previewID: record.id, digest: this.previewDigest(record), operation: record.kind,
      taskID: record.taskID, claimGeneration: record.claimGeneration, agentId: this.agentId }) === true, 'WORKTREE_APPROVAL_REQUIRED');
    await this.claim(record, cleanup); this.paths(record);
    // A coordinated host performs a fresh broker check as the last awaited
    // boundary before synchronous path checks/journal admission/Git invocation.
    if (this.port.revalidate) await this.port.revalidate(record);
    this.paths(record);
    check(record.expiresAt > this.now() && this.now() >= record.createdAt && !this.fault, 'STALE_WORKTREE_PREVIEW');
    return this.records.find(r => r.id === record.id);
  }
  previewDigest(record) {
    const { coordination, ...value } = record;
    return lifecycleDigest(value);
  }
  entries() {
    const output = this.git(['worktree', 'list', '--porcelain', '-z']);
    return output.split('\0\0').filter(Boolean).map(block => Object.fromEntries(block.split('\0').filter(Boolean).map(line => {
      const split = line.indexOf(' '); return split < 0 ? [line, true] : [line.slice(0, split), line.slice(split + 1)];
    })));
  }
  observe(record) {
    this.paths(record);
    const stat = present(record.destination), entry = this.entries().find(e => sameGitPath(e.worktree, record.destination));
    if (!stat && !entry) return 'absent';
    if (!stat || !entry || entry.locked || entry.prunable || !entry.detached || entry.HEAD !== record.revision || !same(serialIdentity(record.destination), record.directory)) return 'unknown';
    // Lexical normalization may match distinct case-sensitive Windows paths.
    // For an existing entry require the actual registered directory as well.
    if (!same(resolvedDirectory(entry.worktree), record.directory)) return 'unknown';
    if (!same(resolvedDirectory(this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], record.destination)), this.commonIdentity) ||
      !same(resolvedDirectory(this.git(['rev-parse', '--show-toplevel'], record.destination)), record.directory)) return 'unknown';
    return 'present';
  }
  async previewCreate(taskID, claimGeneration, revision = 'HEAD') {
    uuid.parse(taskID); integer.parse(claimGeneration);
    check(typeof revision === 'string' && revision.length <= 200 && !revision.startsWith('-') && !revision.includes('\0'), 'INVALID_WORKTREE_REVISION');
    return this.exclusive(async () => {
      this.unresolved();
      const id = randomUUID(), time = this.now();
      const record = Record.parse({ id, resourceID: id, kind: 'create', phase: 'preview', agentId: this.agentId, taskID, claimGeneration,
        repository: this.repository, common: this.common, destination: join(this.root, id, 'tree'),
        revision: this.git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]), createdAt: time, expiresAt: time + 300000 });
      await this.claim(record); return { ...this.put(record), digest: this.previewDigest(record) };
    });
  }
  async create(previewID) {
    uuid.parse(previewID);
    return this.exclusive(async () => {
      let record = this.records.find(r => r.id === previewID && r.agentId === this.agentId && r.kind === 'create');
      check(record, 'WORKTREE_PREVIEW_NOT_FOUND');
      if (record.phase === 'created') { check(this.observe(record) === 'present', 'WORKTREE_RESOURCE_CHANGED'); return structuredClone(record); }
      check(record.phase === 'preview', 'WORKTREE_RECOVERY_REQUIRED'); this.unresolved(record.id);
      record = await this.authorized(record);
      // Filters can run arbitrary configured commands during checkout; this
      // primitive refuses them instead of evaluating destination trust itself.
      this.checkoutSafe();
      check(!present(dirname(record.destination)) && !this.entries().some(e => sameGitPath(e.worktree, record.destination)), 'WORKTREE_DESTINATION_EXISTS');
      mkdirSync(dirname(record.destination), { mode: 0o700 }); mkdirSync(record.destination, { mode: 0o700 });
      record = this.put({ ...record, directory: serialIdentity(record.destination), phase: 'reserved' });
      record = await this.authorized(record); // Claim/approval may change during async native exclusion/authorization.
      this.checkoutSafe();
      record = this.put({ ...record, phase: 'inflight' });
      try {
        this.git(['worktree', 'add', '--detach', '--', record.destination, record.revision]); this.afterEffect(record);
        check(this.observe(record) === 'present', 'UNVERIFIED_WORKTREE_CREATION');
        return this.put({ ...record, phase: 'created' });
      } catch (error) { this.put({ ...record, phase: 'uncertain' }); throw error; }
    });
  }
  checkoutSafe(cwd = this.repository) {
    const names = this.git(['config', '--name-only', '--list'], cwd).split('\n').map(k => k.toLowerCase());
    check(!names.some(k => k.startsWith('filter.')), 'WORKTREE_CHECKOUT_FILTER_UNSUPPORTED');
    check(!names.some(k => k === 'extensions.partialclone' || /^remote\..+\.(promisor|partialclonefilter)$/.test(k)), 'WORKTREE_PARTIAL_CLONE_UNSUPPORTED');
  }
  clean(record) {
    check(this.observe(record) === 'present', 'WORKTREE_RESOURCE_CHANGED');
    this.checkoutSafe(record.destination);
    // Git status/remove can conceal local changes behind index trust bits.
    // Never remove a tree whose ordinary tracked-file verification is disabled.
    check(this.git(['ls-files', '-v', '-z'], record.destination).split('\0').filter(Boolean).every(line => line.startsWith('H ')), 'WORKTREE_INDEX_TRUST_UNSUPPORTED');
    check(this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'], record.destination) === '', 'DIRTY_WORKTREE');
    // Refuse initialized submodules as well: removal is not recursive cleanup.
    check(!this.git(['ls-files', '--stage'], record.destination).split('\n').some(line => line.startsWith('160000 ')), 'WORKTREE_SUBMODULE_UNSUPPORTED');
  }
  async previewRemove(resourceID) {
    uuid.parse(resourceID);
    return this.exclusive(async () => {
      this.unresolved(); const source = this.records.find(r => r.id === resourceID && r.agentId === this.agentId && r.kind === 'create' && r.phase === 'created');
      check(source, 'MANAGED_WORKTREE_NOT_FOUND'); this.clean(source);
      const { coordination, ...resource } = source;
      const time = this.now(), record = { ...resource, id: randomUUID(), kind: 'remove', phase: 'preview', createdAt: time, expiresAt: time + 300000 };
      await this.claim(record, true); return { ...this.put(record), digest: this.previewDigest(record) };
    });
  }
  async remove(previewID) {
    uuid.parse(previewID);
    return this.exclusive(async () => {
      let record = this.records.find(r => r.id === previewID && r.agentId === this.agentId && r.kind === 'remove');
      check(record, 'WORKTREE_PREVIEW_NOT_FOUND');
      if (record.phase === 'removed') { check(this.observe(record) === 'absent', 'WORKTREE_RESOURCE_CHANGED'); return structuredClone(record); }
      check(record.phase === 'preview', 'WORKTREE_RECOVERY_REQUIRED'); this.unresolved(record.id);
      record = await this.authorized(record, true); this.clean(record);
      record = this.put({ ...record, phase: 'inflight' });
      try {
        this.git(['worktree', 'remove', '--', record.destination]); this.afterEffect(record);
        check(this.observe(record) === 'absent', 'UNVERIFIED_WORKTREE_REMOVAL');
        return this.put({ ...record, phase: 'removed' });
      } catch (error) { this.put({ ...record, phase: 'uncertain' }); throw error; }
    });
  }
  async recover() {
    return this.exclusive(async () => {
      for (const record of this.records.filter(r => r.agentId === this.agentId && ['reserved', 'inflight', 'uncertain'].includes(r.phase))) {
        // Observations only. Never add/remove/prune, reacquire approval or repeat
        // a possibly admitted Git effect. Partial checkout remains quarantined.
        let phase = 'uncertain';
        try {
          const observed = this.observe(record);
          if (record.kind === 'create' && record.phase !== 'reserved' && observed === 'present') { this.clean(record); phase = 'created'; }
          if (record.kind === 'remove' && observed === 'absent') phase = 'removed';
        } catch { /* Retain uncertainty; never guess from Git error text. */ }
        this.put({ ...record, phase });
      }
      return structuredClone(this.records.filter(r => r.agentId === this.agentId));
    });
  }
}
