import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const exec = promisify(execFile);
const unavailable = () => Object.assign(new Error('CONTAINED_OWNER_UNAVAILABLE'), { code: 'CONTAINED_OWNER_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('CONTAINED_OWNER_UNCERTAIN'), { code: 'CONTAINED_OWNER_UNCERTAIN' });
const id = z.string().regex(/^[a-f0-9]{64}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const absolute = z.string().refine(x => isAbsolute(x) && normalize(x) === x && !/[\0,]/.test(x));
const mount = z.strictObject({ source: absolute, destination: absolute, mode: z.enum(['ro', 'rw']) });
const specSchema = z.strictObject({ resourceID: z.string().uuid(), image, command: z.array(z.string().min(1).max(4096).refine(x => !x.includes('\0'))).min(1).max(64), mounts: z.array(mount).max(32), init: z.boolean().optional(), volume: z.strictObject({ destination: z.literal('/var/lib/turnlink'), mode: z.enum(['ro', 'rw']) }).optional(),
  codeVolume: z.strictObject({ name: z.string().regex(/^turnlink-opencode-code-fixture-[a-f0-9-]{36}$/), createdAt: z.string().min(1), mountpoint: absolute }).optional(),
  tmpfs: z.array(z.enum(['/tmp', '/run/turnlink-secrets'])).max(2).optional() });
const identity = z.strictObject({ source: absolute, destination: absolute, mode: z.enum(['ro', 'rw']), kind: z.enum(['file', 'directory']), device: z.string(), inode: z.string() });
const volumeSchema = z.strictObject({ name: z.string().regex(/^turnlink-opencode-volume-[a-f0-9-]{36}$/), nonce: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().min(1).optional(), mountpoint: absolute.optional(), originOperationID: z.string().uuid().optional() });
const volumeLabel = 'org.turnlink.opencode.volume-nonce';
const recordSchema = z.strictObject({ version: z.literal(1), resourceID: z.string().uuid(), operationID: z.string().uuid(),
  daemonID: z.string().min(1).max(256), image, digest: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(),
  mounts: z.array(identity).max(32), volume: volumeSchema.optional(), prior: z.strictObject({ operationID: z.string().uuid(), containerID: id }).optional(), phase: z.enum(['volume-creating', 'creating', 'created', 'starting', 'started', 'stopping', 'stopped', 'removing', 'removed']), containerID: id.optional() });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const label = 'org.turnlink.opencode.owner';
const tmpfsOptions = 'rw,noexec,nosuid,nodev,size=16777216';

// Experimental local containment only. Path and content checks are point-in-time;
// mutable mounts can change after inspection. This does not authorize takeover.
export class OpenCodeContainedOwner {
  #file; #lock; #spec; #docker; #env; #busy = false; #closed = false; #compromised = false; #endpoint;
  constructor({ directory, docker, spec }) {
    if (!isAbsolute(directory) || !isAbsolute(docker)) throw unavailable();
    this.#spec = specSchema.parse(spec); this.#docker = docker;
    if (new Set(this.#spec.mounts.map(x => x.destination)).size !== this.#spec.mounts.length ||
        this.#spec.mounts.some(x => x.destination === '/' || x.destination.startsWith('/var/run/docker') || x.destination.startsWith('/run/docker')) ||
        (this.#spec.volume && this.#spec.mounts.some(x => x.destination === this.#spec.volume.destination ||
          x.destination.startsWith(`${this.#spec.volume.destination}/`) || this.#spec.volume.destination.startsWith(`${x.destination}/`))) ||
        (this.#spec.codeVolume && this.#spec.mounts.some(x => x.destination === '/code' || x.destination.startsWith('/code/') || '/code'.startsWith(`${x.destination}/`))) ||
        new Set(this.#spec.tmpfs || []).size !== (this.#spec.tmpfs || []).length ||
        (this.#spec.tmpfs || []).some(path => this.#spec.mounts.some(x => x.destination === path ||
          x.destination.startsWith(`${path}/`) || path.startsWith(`${x.destination}/`)))) throw unavailable();
    this.#env = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'SSL_CERT_FILE']
      .filter(x => typeof process.env[x] === 'string').map(x => [x, process.env[x]]));
    privateDirectory(directory); this.#file = join(directory, `${this.#spec.resourceID}.json`); this.#lock = join(directory, `${this.#spec.resourceID}.writer`);
  }
  async #call(args) {
    if (this.#closed || this.#compromised) throw unavailable();
    try { const out = await exec(this.#docker, args, { env: this.#env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
      if (this.#closed || this.#compromised) throw unavailable(); return out.stdout.trim(); } catch { throw unavailable(); }
  }
  async #daemon() {
    if (!this.#endpoint) {
      const endpoint = this.#env.DOCKER_HOST || await this.#call(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
      let parsed; try { parsed = new URL(endpoint); } catch { throw unavailable(); }
      if (parsed.protocol !== 'unix:' || parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !isAbsolute(parsed.pathname)) throw unavailable();
      this.#endpoint = endpoint; this.#env.DOCKER_HOST = endpoint; delete this.#env.DOCKER_CONTEXT;
    }
    const result = await this.#call(['info', '--format', '{{.ID}}']);
    if (!result || result.length > 256 || /\s/.test(result)) throw unavailable(); return result;
  }
  #mounts() {
    if (!this.#endpoint) throw unavailable();
    const daemonSocket = new URL(this.#endpoint).pathname;
    return this.#spec.mounts.map(({ source, destination, mode }) => {
      const stat = lstatSync(source, { bigint: true });
      if ((!stat.isFile() && !stat.isDirectory()) || realpathSync(source) !== source) throw unavailable();
      // A mount containing the configured daemon socket would expose Docker's API.
      const path = relative(source, daemonSocket);
      if (source === daemonSocket || (stat.isDirectory() && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))) throw unavailable();
      if (stat.isDirectory()) {
        const pending = [source]; let count = 0;
        while (pending.length) {
          const directory = pending.pop();
          for (const entry of readdirSync(directory)) {
            if (++count > 20000) throw unavailable();
            const next = join(directory, entry), info = lstatSync(next, { bigint: true });
            if (info.isSymbolicLink() || info.isSocket() || info.dev !== stat.dev || (!info.isDirectory() && !info.isFile())) throw unavailable();
            if (info.isDirectory()) pending.push(next);
          }
        }
      }
      return { source, destination, mode, kind: stat.isDirectory() ? 'directory' : 'file', device: String(stat.dev), inode: String(stat.ino) };
    });
  }
  #load() {
    const value = recordSchema.parse(JSON.parse(readPrivate(this.#file, 65536)));
    if (value.resourceID !== this.#spec.resourceID || value.image !== this.#spec.image || value.digest !== digest(this.#spec) ||
      value.name !== `turnlink-opencode-${value.operationID}` || !!value.volume !== !!this.#spec.volume ||
      (value.volume && value.volume.name !== `turnlink-opencode-volume-${value.volume.originOperationID || value.operationID}`) || JSON.stringify(value.mounts) !== JSON.stringify(this.#mounts())) throw unavailable();
    return value;
  }
  #save(record) { if (this.#closed || this.#compromised) throw unavailable(); atomicWrite(this.#file, JSON.stringify(recordSchema.parse(record))); return record; }
  async #volume(record, initial = false) {
    if (!record.volume) return undefined;
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    const values = JSON.parse(await this.#call(['volume', 'inspect', record.volume.name]));
    if (!Array.isArray(values) || values.length !== 1) throw unavailable();
    const value = values[0];
    if (value.Name !== record.volume.name || value.Driver !== 'local' || value.Labels?.[volumeLabel] !== record.volume.nonce ||
      typeof value.CreatedAt !== 'string' || !value.CreatedAt || !absolute.safeParse(value.Mountpoint).success ||
      (!initial && (record.volume.createdAt !== value.CreatedAt || record.volume.mountpoint !== value.Mountpoint)) ||
      (value.Options && Object.keys(value.Options).length)) throw unavailable();
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    return { ...record.volume, createdAt: value.CreatedAt, mountpoint: value.Mountpoint };
  }
  async #codeVolume(record) {
    if (!this.#spec.codeVolume) return undefined;
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    const values = JSON.parse(await this.#call(['volume', 'inspect', this.#spec.codeVolume.name]));
    const value = Array.isArray(values) && values.length === 1 && values[0];
    if (!value || value.Name !== this.#spec.codeVolume.name || value.Driver !== 'local' || value.CreatedAt !== this.#spec.codeVolume.createdAt ||
        value.Mountpoint !== this.#spec.codeVolume.mountpoint || value.Labels?.['org.turnlink.fixture'] !== 'opencode-code-v1' ||
        (value.Options && Object.keys(value.Options).length)) throw unavailable();
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    return value;
  }
  async #inspect(record) {
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    await this.#volume(record);
    await this.#codeVolume(record);
    const all = JSON.parse(await this.#call(['inspect', record.containerID || record.name]));
    if (!Array.isArray(all) || all.length !== 1) throw unavailable();
    const x = all[0], h = x.HostConfig, c = x.Config;
    const expected = record.mounts.map(m => ({ type: 'bind', source: m.source, destination: m.destination, rw: m.mode === 'rw' }));
    if (record.volume) expected.push({ type: 'volume', source: record.volume.name, destination: this.#spec.volume.destination, rw: this.#spec.volume.mode === 'rw' });
    if (this.#spec.codeVolume) expected.push({ type: 'volume', source: this.#spec.codeVolume.name, destination: '/code', rw: false });
    expected.sort((a,b) => a.destination.localeCompare(b.destination));
    const actual = (x.Mounts || []).map(m => {
      if (typeof m.RW !== 'boolean') throw unavailable();
      if (m.Type === 'bind' && m.Propagation === 'rprivate') return { type: 'bind', source: m.Source, destination: m.Destination, rw: m.RW };
      if (m.Type === 'volume' && record.volume && m.Name === record.volume.name && m.Source === record.volume.mountpoint && m.Driver === 'local')
        return { type: 'volume', source: m.Name, destination: m.Destination, rw: m.RW };
      if (m.Type === 'volume' && this.#spec.codeVolume && m.Name === this.#spec.codeVolume.name && m.Source === this.#spec.codeVolume.mountpoint && m.Driver === 'local')
        return { type: 'volume', source: m.Name, destination: m.Destination, rw: m.RW };
      throw unavailable();
    }).sort((a,b) => a.destination.localeCompare(b.destination));
    const expectedTmpfs = Object.fromEntries((this.#spec.tmpfs || []).slice().sort().map(path => [path, tmpfsOptions]));
    const actualTmpfs = Object.fromEntries(Object.entries(h?.Tmpfs || {}).sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(actualTmpfs) !== JSON.stringify(expectedTmpfs)) throw unavailable();
    if (!id.safeParse(x.Id).success || (record.containerID && x.Id !== record.containerID) || x.Name !== `/${record.name}` || x.Image !== record.image ||
      c?.Labels?.[label] !== record.operationID || c?.OpenStdin !== true || JSON.stringify(c?.Cmd) !== JSON.stringify(this.#spec.command) ||
      h?.NetworkMode !== 'none' || h.Privileged !== false || h.ReadonlyRootfs !== true || h.PidMode !== '' || h.IpcMode !== 'private' || h.UsernsMode !== '' ||
      (this.#spec.init === true ? h.Init !== true : h.Init === true) ||
      h.RestartPolicy?.Name !== 'no' || h.PidsLimit !== 128 || (h.CapAdd || []).length || (h.Devices || []).length || (h.DeviceRequests || []).length ||
      !h.CapDrop?.includes('ALL') || !h.SecurityOpt?.includes('no-new-privileges') ||
      Object.keys(x.NetworkSettings?.Networks || {}).some(n => n !== 'none') || JSON.stringify(actual) !== JSON.stringify(expected) ||
      JSON.stringify(record.mounts) !== JSON.stringify(this.#mounts()) || typeof x.State?.Running !== 'boolean') throw unavailable();
    await this.#volume(record); await this.#codeVolume(record);
    return { containerID: x.Id, running: x.State.Running, status: x.State.Status };
  }
  async #exclusive(fn) {
    if (this.#closed || this.#busy || this.#compromised) throw unavailable(); this.#busy = true; let unlock;
    try { unlock = acquireStore(this.#lock, () => { this.#compromised = true; }); const result = await fn(); if (this.#compromised) throw unavailable(); return result; }
    finally { unlock?.(); this.#busy = false; }
  }
  async create() { return this.#exclusive(async () => {
    const daemonID = await this.#daemon();
    try { this.#load(); throw unavailable(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const operationID = randomUUID(), mounts = this.#mounts(); let record = this.#save({ version: 1, resourceID: this.#spec.resourceID, operationID,
      daemonID, image: this.#spec.image, digest: digest(this.#spec), name: `turnlink-opencode-${operationID}`, mounts,
      ...(this.#spec.volume ? { volume: { name: `turnlink-opencode-volume-${operationID}`, nonce: randomBytes(32).toString('hex') } } : {}),
      phase: this.#spec.volume ? 'volume-creating' : 'creating' });
    try {
      if (record.volume) {
        const name = await this.#call(['volume', 'create', '--driver', 'local', '--label', `${volumeLabel}=${record.volume.nonce}`, record.volume.name]);
        if (name !== record.volume.name) throw uncertain();
        const volume = await this.#volume(record, true); record = this.#save({ ...record, volume, phase: 'creating' });
        await this.#volume(record);
      }
      const args = ['create', '--interactive', '--pull=never', '--name', record.name, '--label', `${label}=${operationID}`, '--network=none', '--ipc=private', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--restart=no'];
      if (this.#spec.init) args.push('--init');
      if (record.volume) args.push('--mount', `type=volume,src=${record.volume.name},dst=${this.#spec.volume.destination},volume-nocopy${this.#spec.volume.mode === 'ro' ? ',readonly' : ''}`);
      if (this.#spec.codeVolume) { await this.#codeVolume(record); args.push('--mount', `type=volume,src=${this.#spec.codeVolume.name},dst=/code,volume-nocopy,readonly`); }
      for (const path of this.#spec.tmpfs || []) args.push('--tmpfs', `${path}:${tmpfsOptions}`);
      for (const m of mounts) args.push('--mount', `type=bind,src=${m.source},dst=${m.destination},${m.mode === 'ro' ? 'readonly,' : ''}bind-propagation=rprivate`);
      const containerID = await this.#call([...args, record.image, ...this.#spec.command]); if (!id.safeParse(containerID).success) throw uncertain();
      const state = await this.#inspect({ ...record, containerID }); if (state.running || state.status !== 'created') throw uncertain();
      record = this.#save({ ...record, containerID, phase: 'created' }); return { resourceID: record.resourceID, operationID, daemonID: record.daemonID, containerID };
    } catch { throw uncertain(); }
  }); }
  async observe() { return this.#exclusive(async () => {
    await this.#daemon(); let record = this.#load(); const state = await this.#inspect(record);
    if (record.phase === 'creating' && !state.running && state.status === 'created') record = this.#save({ ...record, containerID: state.containerID, phase: 'created' });
    if (record.phase === 'starting' && state.running) record = this.#save({ ...record, phase: 'started' });
    if (record.phase === 'stopping' && !state.running && state.status === 'exited') record = this.#save({ ...record, phase: 'stopped' });
    return { resourceID: record.resourceID, operationID: record.operationID, daemonID: record.daemonID, ...state, phase: record.phase };
  }); }
  // Verifies only the Docker mount binding, not the inode or symlink status of
  // the path within the volume. This snapshot is not a held verifier lease.
  async assertDatabaseVolume(path) { return this.#exclusive(async () => {
    if (path !== '/var/lib/turnlink/opencode.sqlite' || !this.#spec.volume || this.#spec.volume.mode !== 'rw') throw unavailable();
    await this.#daemon(); const record = this.#load();
    if (!record.containerID || !record.volume) throw unavailable();
    await this.#inspect(record); const volume = await this.#volume(record);
    return { daemonID: record.daemonID, containerID: record.containerID,
      volume: { name: volume.name, driver: 'local', createdAt: volume.createdAt, mountpoint: volume.mountpoint,
        destination: this.#spec.volume.destination } };
  }); }
  async assertIsolatedDatabaseVolume(path) {
    if (this.#spec.mounts.length || !this.#spec.volume || this.#spec.volume.mode !== 'rw' ||
        JSON.stringify([...(this.#spec.tmpfs || [])].sort()) !== JSON.stringify(['/run/turnlink-secrets', '/tmp'].sort())) throw unavailable();
    return this.assertDatabaseVolume(path);
  }
  // One bracketed Docker inspection yields both owner and volume identity.
  // This avoids two independent inspections while preserving the checks before
  // and after the container inspection in #inspect.
  async observeIsolatedDatabaseVolume(path) { return this.#exclusive(async () => {
    if (path !== '/var/lib/turnlink/opencode.sqlite' || this.#spec.mounts.length || !this.#spec.volume || this.#spec.volume.mode !== 'rw' ||
        JSON.stringify([...(this.#spec.tmpfs || [])].sort()) !== JSON.stringify(['/run/turnlink-secrets', '/tmp'].sort())) throw unavailable();
    await this.#daemon(); const record = this.#load();
    if (!record.containerID || !record.volume?.createdAt || !record.volume.mountpoint) throw unavailable();
    const state = await this.#inspect(record);
    return { observed: { resourceID: record.resourceID, operationID: record.operationID, daemonID: record.daemonID, ...state, phase: record.phase },
      volume: { daemonID: record.daemonID, containerID: state.containerID, volume: { name: record.volume.name, driver: 'local',
        createdAt: record.volume.createdAt, mountpoint: record.volume.mountpoint, destination: this.#spec.volume.destination } } };
  }); }
  // Local custody only: the Docker daemon and its other clients remain trusted.
  // An interrupted remove is observed again, never blindly force-replayed.
  async retireVolumeOwner() { return this.#exclusive(async () => {
    if (this.#spec.mounts.length || !this.#spec.volume || this.#spec.volume.mode !== 'rw') throw unavailable();
    let record = this.#load();
    if (!record.containerID || !record.volume || !['started', 'stopped', 'removing', 'removed'].includes(record.phase)) throw unavailable();
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    await this.#volume(record);
    if (record.phase !== 'removing' && record.phase !== 'removed') {
      const state = await this.#inspect(record);
      if (state.running || state.status !== 'exited') throw unavailable();
      record = this.#save({ ...record, phase: 'removing' });
    }
    const list = () => this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `id=${record.containerID}`]);
    let current = await list();
    if (record.phase === 'removed' && current) throw unavailable();
    if (current) {
      if (current !== record.containerID) throw unavailable();
      const state = await this.#inspect(record);
      if (state.running || state.status !== 'exited') throw unavailable();
      try { await this.#call(['container', 'rm', record.containerID]); } catch { throw uncertain(); }
    }
    if (await list() || await this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `volume=${record.volume.name}`])) throw uncertain();
    const volume = await this.#volume(record);
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    if (record.phase !== 'removed') record = this.#save({ ...record, phase: 'removed' });
    return Object.freeze({ resourceID: record.resourceID, operationID: record.operationID, daemonID: record.daemonID,
      containerID: record.containerID, volume: Object.freeze({ ...volume }) });
  }); }
  // Experimental local handoff of the same volume, not broker authorization.
  // Intent is durable before Docker create; ambiguous creates are never replayed.
  async createVolumeSuccessor() { return this.#exclusive(async () => {
    if (this.#spec.mounts.length || !this.#spec.volume || this.#spec.volume.mode !== 'rw') throw unavailable();
    const old = this.#load();
    if (old.phase !== 'removed' || !old.containerID || !old.volume || await this.#daemon() !== old.daemonID) throw unavailable();
    await this.#volume(old);
    if (await this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `id=${old.containerID}`]) ||
        await this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `volume=${old.volume.name}`])) throw unavailable();
    const operationID = randomUUID();
    let next = this.#save({ ...old, operationID, name: `turnlink-opencode-${operationID}`, containerID: undefined,
      prior: { operationID: old.operationID, containerID: old.containerID },
      volume: { ...old.volume, originOperationID: old.volume.originOperationID || old.operationID }, phase: 'creating' });
    try {
      const args = ['create', '--interactive', '--pull=never', '--name', next.name, '--label', `${label}=${operationID}`, '--network=none',
        '--ipc=private', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--restart=no',
        '--mount', `type=volume,src=${next.volume.name},dst=${this.#spec.volume.destination},volume-nocopy`];
      if (this.#spec.init) args.push('--init');
      if (this.#spec.codeVolume) { await this.#codeVolume(next); args.push('--mount', `type=volume,src=${this.#spec.codeVolume.name},dst=/code,volume-nocopy,readonly`); }
      for (const path of this.#spec.tmpfs || []) args.push('--tmpfs', `${path}:${tmpfsOptions}`);
      const containerID = await this.#call([...args, next.image, ...this.#spec.command]);
      if (!id.safeParse(containerID).success) throw uncertain();
      const state = await this.#inspect({ ...next, containerID });
      if (state.running || state.status !== 'created') throw uncertain();
      next = this.#save({ ...next, containerID, phase: 'created' });
      return { resourceID: next.resourceID, operationID, daemonID: next.daemonID, containerID, prior: next.prior };
    } catch { throw uncertain(); }
  }); }
  // Trusted host observation only. A native recovery lease must separately
  // remain held; this Docker observation is not by itself takeover authority.
  async observeVolumeSuccessor(previous) { return this.#exclusive(async () => {
    const old = z.strictObject({ daemonID: z.string().min(1), operationID: z.string().uuid(), containerID: id,
      volume: z.strictObject({ name: z.string(), createdAt: z.string(), destination: z.literal('/var/lib/turnlink') }) }).parse(previous);
    if (this.#spec.mounts.length || this.#spec.volume?.mode !== 'rw') throw unavailable();
    const record = this.#load();
    if (record.phase !== 'started' || !record.prior || record.daemonID !== old.daemonID ||
        record.prior.containerID !== old.containerID || record.prior.operationID !== old.operationID ||
        record.volume?.name !== old.volume.name || record.volume?.createdAt !== old.volume.createdAt ||
        this.#spec.volume.destination !== old.volume.destination || await this.#daemon() !== old.daemonID) throw unavailable();
    const before = await this.#inspect(record);
    if (!before.running || before.status !== 'running' || before.containerID === old.containerID) throw unavailable();
    if (await this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `id=${old.containerID}`])) throw unavailable();
    const mounted = await this.#call(['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', `volume=${old.volume.name}`]);
    if (mounted !== record.containerID) throw unavailable();
    const after = await this.#inspect(record);
    if (!after.running || after.status !== 'running' || JSON.stringify(after) !== JSON.stringify(before) ||
        await this.#daemon() !== old.daemonID) throw unavailable();
    return Object.freeze({ daemonID: record.daemonID, operationID: record.operationID, containerID: record.containerID,
      previous: Object.freeze(old) });
  }); }
  async start() { return this.#exclusive(async () => {
    await this.#daemon(); let record = this.#load(); if (record.phase !== 'created') throw unavailable();
    const state = await this.#inspect(record); if (state.running || state.status !== 'created') throw unavailable();
    record = this.#save({ ...record, phase: 'starting' });
    try { await this.#call(['start', record.containerID]); const after = await this.#inspect(record); if (!after.running || after.status !== 'running') throw uncertain();
      record = this.#save({ ...record, phase: 'started' }); return { operationID: record.operationID, containerID: record.containerID, daemonID: record.daemonID }; } catch { throw uncertain(); }
  }); }
  // Start once with an attached byte stream. A lost/failed spawn response leaves
  // durable starting state and is never authority to start the container again.
  async startInteractive() { return this.#exclusive(async () => {
    await this.#daemon(); let record = this.#load(); if (record.phase !== 'created') throw unavailable();
    const state = await this.#inspect(record); if (state.running || state.status !== 'created') throw unavailable();
    record = this.#save({ ...record, phase: 'starting' });
    const child = spawn(this.#docker, ['start', '--attach', '--interactive', record.containerID],
      { env: this.#env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {}); child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
    const exited = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', () => resolve({ code: null, signal: null, error: 'CONTAINED_OWNER_UNAVAILABLE' }));
    });
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const after = await this.#inspect(record);
        if (after.running && after.status === 'running') return Object.freeze({ child, exited, operationID: record.operationID, containerID: record.containerID, daemonID: record.daemonID });
        if (after.status !== 'created') break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } catch { /* A dispatched start remains uncertain. */ }
    child.kill('SIGKILL'); throw uncertain();
  }); }
  async stop() { return this.#exclusive(async () => {
    await this.#daemon(); let record = this.#load(); if (!['starting','started','stopping','stopped'].includes(record.phase)) throw unavailable();
    let state = await this.#inspect(record);
    if (record.phase === 'stopping' && state.running) throw uncertain();
    if (!['stopping','stopped'].includes(record.phase)) { record = this.#save({ ...record, phase: 'stopping' });
      if (state.running) { try { await this.#call(['stop', '--time', '2', record.containerID]); } catch { throw uncertain(); } } }
    state = await this.#inspect(record); if (state.running || state.status !== 'exited') throw uncertain();
    if (record.phase !== 'stopped') record = this.#save({ ...record, phase: 'stopped' });
    return { operationID: record.operationID, containerID: record.containerID, daemonID: record.daemonID, status: 'stopped_local' };
  }); }
  close() { this.#closed = true; }
}
