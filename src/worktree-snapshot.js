import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseJSONC } from 'jsonc-parser';
import { parse as parseTOML } from 'smol-toml';
import { z } from 'zod';
import { digest } from './config.js';
import { AgentID } from './protocol.js';
import { requireControl as check, ControlError } from './control/policy.js';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, item) => plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
const hash = value => digest(canonical(value));
const parents = path => { const entries = []; for (;;) { entries.push(path); const next = dirname(path); if (next === path) return entries; path = next; } };
const regularPath = path => {
  for (const ancestor of parents(path).reverse()) {
    try { check(!lstatSync(ancestor).isSymbolicLink(), 'SNAPSHOT_SYMLINK_REFUSED'); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  return true;
};

// Reads source bytes, never imports a module, starts a destination harness, resolves credentials or fetches a URL.
class Inventory {
  constructor({ fileBytes = 1024 * 1024, totalBytes = 8 * 1024 * 1024, files = 512 } = {}) {
    check([fileBytes, totalBytes, files].every(v => Number.isSafeInteger(v) && v > 0), 'INVALID_SNAPSHOT_LIMIT');
    this.limits = { fileBytes, totalBytes, files }; this.bytes = 0; this.records = new Map();
  }
  read(path, kind) {
    path = resolve(path);
    if (this.records.has(path)) return this.records.get(path);
    check(this.records.size < this.limits.files, 'SNAPSHOT_BUDGET_EXCEEDED');
    if (!regularPath(path)) {
      const record = { path, kind, present: false, digest: hash({ missing: true }) }; this.records.set(path, record); return record;
    }
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    try {
      const before = fstatSync(descriptor);
      check(before.isFile() && before.nlink === 1, 'SNAPSHOT_FILE_REFUSED');
      check(before.size <= this.limits.fileBytes && this.bytes + before.size <= this.limits.totalBytes, 'SNAPSHOT_BUDGET_EXCEEDED');
      const limit = Math.min(this.limits.fileBytes, this.limits.totalBytes - this.bytes);
      const buffer = Buffer.alloc(Math.min(before.size + 1, limit + 1)); let length = 0;
      while (length < buffer.length) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, null); if (!count) break; length += count;
      }
      const content = buffer.subarray(0, length);
      check(content.length === before.size, 'SNAPSHOT_SOURCE_CHANGED');
      check(content.length <= this.limits.fileBytes && this.bytes + content.length <= this.limits.totalBytes, 'SNAPSHOT_BUDGET_EXCEEDED');
      const after = fstatSync(descriptor), current = lstatSync(path);
      check(before.dev === current.dev && before.ino === current.ino && before.size === after.size && before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs && !current.isSymbolicLink(), 'SNAPSHOT_SOURCE_CHANGED');
      this.bytes += content.length;
      const record = { path, kind, present: true, digest: digest(content), content }; this.records.set(path, record); return record;
    } finally { closeSync(descriptor); }
  }
  directory(path) {
    path = resolve(path);
    const prior = this.records.get(path); if (prior) return prior.entries || [];
    check(this.records.size < this.limits.files, 'SNAPSHOT_BUDGET_EXCEEDED');
    const present = regularPath(path);
    if (present) check(lstatSync(path).isDirectory(), 'SNAPSHOT_FILE_REFUSED');
    const entries = present ? readdirSync(path).sort() : [];
    check(entries.length <= this.limits.files, 'SNAPSHOT_BUDGET_EXCEEDED');
    this.records.set(path, { path, kind: 'directory', present, digest: hash({ present, entries }), entries }); return entries;
  }
  public() { return [...this.records.values()].map(({ path, kind, present, digest }) => ({ path, kind, present, digest })); }
  verify() {
    const fresh = new Inventory(this.limits);
    for (const record of this.records.values()) {
      if (record.kind === 'directory') fresh.directory(record.path);
      const next = record.kind === 'directory' ? fresh.records.get(record.path) : fresh.read(record.path, record.kind);
      check(next.present === record.present && next.digest === record.digest, 'SNAPSHOT_SOURCE_CHANGED');
    }
  }
}

const parseConfig = (record, harness) => {
  if (!record.present) return;
  try {
    const text = record.content.toString('utf8');
    check(Buffer.from(text).equals(record.content), 'SNAPSHOT_ENCODING_REFUSED');
    const errors = [];
    const value = harness === 'codex' ? parseTOML(text) : parseJSONC(text, errors, { allowTrailingComma: true });
    check(!errors.length && plain(value), 'SNAPSHOT_CONFIG_INVALID');
    const validate = item => {
      if (Array.isArray(item)) { item.forEach(validate); return; }
      if (plain(item)) {
        check([Object.prototype, null].includes(Object.getPrototypeOf(item)), 'SNAPSHOT_CONFIG_INVALID');
        for (const [key, child] of Object.entries(item)) {
          check(!['__proto__', 'prototype', 'constructor'].includes(key), 'SNAPSHOT_CONFIG_INVALID'); validate(child);
        }
      } else check(item === null || ['string', 'boolean'].includes(typeof item) || (typeof item === 'number' && Number.isFinite(item)), 'SNAPSHOT_CONFIG_INVALID');
    };
    validate(value);
    return value;
  } catch { throw new ControlError('SNAPSHOT_CONFIG_INVALID'); }
};

const repository = directory => {
  directory = realpathSync(directory); check(lstatSync(directory).isDirectory(), 'SNAPSHOT_FILE_REFUSED');
  // rev-parse is read-only; ignore caller-selected Git directories/config/environment redirects.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (...args) => execFileSync('git', ['-C', directory, 'rev-parse', ...args], { env, encoding: 'utf8', timeout: 3000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const root = realpathSync(git('--show-toplevel')), common = realpathSync(git('--path-format=absolute', '--git-common-dir'));
    return { directory, root, common };
  } catch { throw new ControlError('SNAPSHOT_REPOSITORY_UNVERIFIED'); }
};

const dynamicKeys = new Set(['plugins', 'mcp', 'skills', 'references', 'commands', 'agents', 'policies', 'formatter', 'lsp', 'shell',
  'mcp_servers', 'features', 'profiles', 'profile', 'projects', 'developer_instructions', 'model_instructions_file', 'experimental_instructions_file',
  'project_doc_fallback_filenames', 'project_doc_max_bytes', 'sandbox_workspace_write', 'permissions', 'hooks']);
const knownKeys = {
  opencode: new Set(['$schema', 'model', 'default_agent', 'permissions', 'providers', 'instructions', 'snapshots', 'update', 'share', 'username',
    'compaction', 'media', 'watcher', 'tool_output', 'warming', ...dynamicKeys]),
  codex: new Set(['model', 'model_provider', 'model_providers', 'approval_policy', 'sandbox_mode', 'model_reasoning_effort', 'model_verbosity',
    'model_context_window', 'model_auto_compact_token_limit', 'history', 'tui', ...dynamicKeys]),
};
const configIssues = (documents, harness) => {
  const issues = new Set();
  for (const document of documents) {
    for (const key of Object.keys(document)) {
      if (!knownKeys[harness].has(key)) issues.add('UNKNOWN_CONFIGURATION_FIELD_REQUIRE_NATIVE_RESOLUTION');
      if (dynamicKeys.has(key) && !(harness === 'opencode' && key === 'permissions')) issues.add('DYNAMIC_OR_UNRESOLVED_CONFIGURATION');
      if (key === 'warming' && document[key] !== false) issues.add('AUTONOMOUS_NATIVE_WORK_REQUIRE_EXCLUSION');
    }
    const inspect = (value, key = '') => {
      if (typeof value === 'string') {
        if (/\{(?:env|file):/.test(value)) issues.add('UNRESOLVED_CONFIGURATION_SUBSTITUTION');
        if (key === 'resource' && value !== '*') issues.add('PATH_DEPENDENT_PERMISSION_RULE');
        if (key === 'package' && value !== '@opencode/ai/providers/openai-compatible') issues.add('CUSTOM_PROVIDER_CODE');
      } else if (Array.isArray(value)) value.forEach(item => inspect(item));
      else if (plain(value)) Object.entries(value).forEach(([k, v]) => inspect(v, k));
    };
    inspect(document);
  }
  return [...issues];
};

function discover({ harness, repo, home, globalDirectory, systemDirectories, environment, inventory }) {
  const documents = [], issues = new Set(), instructionPaths = [];
  const config = path => { const value = parseConfig(inventory.read(path, 'configuration'), harness); if (value) documents.push(value); };
  const instruction = path => {
    const record = inventory.read(path, 'instruction');
    if (record.present) check(Buffer.from(record.content.toString('utf8')).equals(record.content), 'SNAPSHOT_ENCODING_REFUSED');
    instructionPaths.push(resolve(path)); return record;
  };
  const codexInstruction = path => {
    const candidates = ['AGENTS.override.md', 'AGENTS.md'].map(name => inventory.read(join(path, name), 'instruction'));
    for (const record of candidates) if (record.present) check(Buffer.from(record.content.toString('utf8')).equals(record.content), 'SNAPSHOT_ENCODING_REFUSED');
    const selected = candidates.find(record => record.present && record.content.toString('utf8').trim().length);
    if (selected) instructionPaths.push(selected.path);
  };
  const directoryPolicy = path => {
    for (const name of ['agents', 'commands', 'skills', 'plugins', 'tools', 'policies']) {
      if (inventory.directory(join(path, name)).length) issues.add('DIRECTORY_DEFINITIONS_REQUIRE_NATIVE_RESOLUTION');
    }
  };
  if (harness === 'opencode') {
    for (const path of [join(globalDirectory, 'opencode.json'), join(globalDirectory, 'opencode.jsonc')]) config(path);
    directoryPolicy(globalDirectory); instruction(join(globalDirectory, 'AGENTS.md'));
    const chain = parents(repo.directory).reverse();
    for (const path of chain) { config(join(path, 'opencode.json')); config(join(path, 'opencode.jsonc')); }
    for (const path of chain) {
      config(join(path, '.opencode', 'opencode.json')); config(join(path, '.opencode', 'opencode.jsonc')); directoryPolicy(join(path, '.opencode'));
    }
    for (const path of systemDirectories) { config(join(path, 'opencode.json')); config(join(path, 'opencode.jsonc')); directoryPolicy(path); instruction(join(path, 'AGENTS.md')); }
    const boundary = within(home, repo.directory) ? home : repo.root;
    for (const path of parents(repo.directory)) {
      if (!within(boundary, path)) break;
      instruction(join(path, 'AGENTS.md')); if (path === boundary) break;
    }
    for (const document of documents) {
      check(document.instructions === undefined || Array.isArray(document.instructions), 'SNAPSHOT_CONFIG_INVALID');
      for (const entry of document.instructions || []) {
        check(typeof entry === 'string', 'SNAPSHOT_CONFIG_INVALID');
        if (/^https?:\/\//.test(entry) || /[*?\[\]{}]/.test(entry)) { issues.add('REMOTE_OR_GLOB_INSTRUCTION_UNRESOLVED'); continue; }
        if (entry.startsWith('~/')) instruction(join(home, entry.slice(2)));
        else if (isAbsolute(entry)) instruction(entry);
        else {
          for (const path of parents(repo.directory)) {
            if (!within(repo.root, path)) break;
            const target = resolve(path, entry);
            if (!within(repo.root, target)) { issues.add('EXTERNAL_RELATIVE_INSTRUCTION_UNRESOLVED'); continue; }
            instruction(target);
          }
        }
      }
    }
    if (Object.keys(environment).some(key => key.startsWith('OPENCODE_') && key !== 'OPENCODE_LOG_LEVEL')) issues.add('RUNTIME_CONFIGURATION_OVERRIDE_UNRESOLVED');
    if (process.platform === 'darwin') issues.add('MANAGED_PREFERENCES_REQUIRE_NATIVE_RESOLUTION');
  } else {
    config(join(globalDirectory, 'config.toml'));
    codexInstruction(globalDirectory);
    directoryPolicy(globalDirectory);
    for (const path of parents(repo.directory).reverse().filter(path => within(repo.root, path))) {
      const local = inventory.read(join(path, '.codex', 'config.toml'), 'configuration');
      if (local.present) { parseConfig(local, harness); issues.add('PROJECT_CONFIG_TRUST_REQUIRE_NATIVE_RESOLUTION'); }
      directoryPolicy(join(path, '.codex'));
      codexInstruction(path);
    }
    if (instructionPaths.reduce((sum, path) => sum + inventory.records.get(path).content.length, 0) > 32768) issues.add('INSTRUCTION_BYTE_LIMIT_REQUIRE_NATIVE_RESOLUTION');
    issues.add('CODEX_REQUIREMENTS_AND_TOOL_INVENTORY_REQUIRE_NATIVE_RESOLUTION');
  }
  return { documents, issues: [...new Set([...issues, ...configIssues(documents, harness)])], instructionPaths };
}

// Bound to a native source conversation. Destinations are inspected offline, never by loading their harness/plugins/commands.
// Profiles are observational candidates: they are NOT sufficient native exclusion/rebind authority for live movement.
export class NativeWorktreeSnapshotReader {
  constructor({ harness, sessionID, native, home, globalDirectory, systemDirectories = [], environment, limits }) {
    check(['opencode', 'codex'].includes(harness), 'HARNESS_EXECUTION_DEFERRED');
    AgentID.parse(`${harness}:${sessionID}`); check(typeof native === 'function', 'NATIVE_SNAPSHOT_REQUIRED');
    check([home, globalDirectory, ...systemDirectories].every(isAbsolute), 'ABSOLUTE_SNAPSHOT_ROOT_REQUIRED');
    const canonicalHome = realpathSync(home), declaredHome = resolve(home), declaredGlobal = resolve(globalDirectory);
    const canonicalGlobal = within(declaredHome, declaredGlobal) ? join(canonicalHome, relative(declaredHome, declaredGlobal)) : declaredGlobal;
    Object.assign(this, { harness, sessionID, native, home: canonicalHome, globalDirectory: canonicalGlobal,
      systemDirectories: systemDirectories.map(path => resolve(path)), environment: { ...environment }, environmentKnown: environment !== undefined, limits });
  }
  async readNative() {
    const value = await this.native();
    check(value && value.sessionID === this.sessionID && value.harness === this.harness && isAbsolute(value.directory), 'TRANSITION_IDENTITY_MISMATCH');
    const authority = z.strictObject({ selectedAgent: z.string().optional(), model: z.json(), permissions: z.json(),
      tools: z.array(z.json()), sandbox: z.json().optional(), approvalPolicy: z.json().optional(), agentDefinitionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      instructionEntriesDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(value.authority);
    check(typeof value.idle === 'boolean' && typeof value.blocked === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      typeof value.resolvedConfigurationDigest === 'string' && /^[a-f0-9]{64}$/.test(value.resolvedConfigurationDigest), 'NATIVE_SNAPSHOT_REQUIRED');
    return { ...value, directory: realpathSync(value.directory), authority };
  }
  async inspectPair(to) {
    try {
      check(isAbsolute(to), 'ABSOLUTE_SNAPSHOT_ROOT_REQUIRED');
      const native = await this.readNative(), sourceRepo = repository(native.directory), destinationRepo = repository(to);
      check(sourceRepo.common === destinationRepo.common && destinationRepo.root === destinationRepo.directory, 'WORKTREE_PROJECT_MISMATCH');
      const inventory = new Inventory(this.limits), base = { harness: this.harness, home: this.home, globalDirectory: this.globalDirectory,
        systemDirectories: this.systemDirectories, environment: this.environment, inventory };
      const sourceProfile = discover({ ...base, repo: sourceRepo }), destinationProfile = discover({ ...base, repo: destinationRepo });
      const nativeAfter = await this.readNative();
      const changes = [native.directory !== nativeAfter.directory ? 'location' : undefined,
        hash(native.authority) !== hash(nativeAfter.authority) ? 'authority' : undefined,
        native.idle !== nativeAfter.idle || native.blocked !== nativeAfter.blocked || native.revision !== nativeAfter.revision ? 'activity' : undefined,
        native.resolvedConfigurationDigest !== nativeAfter.resolvedConfigurationDigest ? 'configuration' : undefined].filter(Boolean);
      if (changes.length) { const error = new ControlError('NATIVE_SNAPSHOT_CHANGED'); error.reason = changes.join(','); throw error; }
      inventory.verify();
      const records = inventory.public(), issues = [...new Set([...sourceProfile.issues, ...destinationProfile.issues,
        'DESTINATION_NATIVE_AUTHORITY_UNVERIFIED', 'NATIVE_EXCLUSION_UNVERIFIED', 'DESTINATION_REBIND_UNVERIFIED'])];
      if (!this.environmentKnown) issues.push('RUNTIME_ENVIRONMENT_UNVERIFIED');
      const sourceConfigDigest = hash(sourceProfile.documents), destinationConfigDigest = hash(destinationProfile.documents);
      if (sourceConfigDigest !== destinationConfigDigest) issues.push('DESTINATION_CONFIGURATION_REQUIRES_NATIVE_RESOLUTION');
      const nativeAuthorityDigest = hash(native.authority);
      const nativeText = canonical(native.authority.permissions);
      if (/"resource":"(?!\*")/.test(nativeText)) issues.push('PATH_DEPENDENT_PERMISSION_RULE');
      if (this.harness === 'codex' && native.authority.sandbox === undefined) issues.push('NATIVE_SANDBOX_REQUIRED');
      const projectID = hash({ gitCommonDirectory: sourceRepo.common });
      const snapshot = (repo, profile, configDigest) => ({ agentId: `${this.harness}:${this.sessionID}`, directory: repo.directory, projectID,
        configurationDigest: hash({ records, instructions: profile.instructionPaths, configDigest, environmentDigest: hash(this.environment),
          nativeConfigurationDigest: native.resolvedConfigurationDigest }),
        authorityDigest: hash({ nativeAuthorityDigest, configDigest }),
        sources: records.map(({ path, digest }) => ({ path, digest })), idle: native.idle, blocked: native.blocked });
      return { source: snapshot(sourceRepo, sourceProfile, sourceConfigDigest), destination: snapshot(destinationRepo, destinationProfile, destinationConfigDigest),
        records, issues: [...new Set(issues)], nativeAuthorityDigest, destinationMode: 'offline', executionEligible: false,
        instructionCandidates: { source: sourceProfile.instructionPaths, destination: destinationProfile.instructionPaths } };
    } catch (error) {
      if (error instanceof ControlError) throw error;
      throw new ControlError('NATIVE_SNAPSHOT_UNAVAILABLE');
    }
  }
}
