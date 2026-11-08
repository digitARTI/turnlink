import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const exec = promisify(execFile);
const unavailable = () => Object.assign(new Error('CONTAINED_MCP_UNAVAILABLE'), { code: 'CONTAINED_MCP_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('CONTAINED_MCP_UNCERTAIN'), { code: 'CONTAINED_MCP_UNCERTAIN' });
const imageID = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const peerSchema = z.strictObject({ path: z.string().max(100).refine(isAbsolute), nonce: z.string().regex(/^[a-f0-9]{64}$/),
  device: z.string().regex(/^[0-9]+$/), inode: z.string().regex(/^[0-9]+$/) });
const capturedIdentity = z.strictObject({ resourceID: z.string().uuid(), operationID: z.string().uuid(),
  containerID: z.string().regex(/^[a-f0-9]{64}$/), wrapperPID: z.number().int().positive().max(0xffffffff),
  daemonID: z.string().min(1).max(256).refine(value => !/\s/.test(value)).optional() });
const specSchema = z.strictObject({ resourceID: z.string().uuid(), image: imageID,
  command: z.array(z.string().min(1).max(4096).refine(value => !value.includes('\0'))).min(1).max(64) });
const recordSchema = z.strictObject({ version: z.literal(1), resourceID: z.string().uuid(), operationID: z.string().uuid(),
  daemonID: z.string().min(1).max(256), image: imageID, commandDigest: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().regex(/^turnlink-mcp-[a-f0-9-]{36}$/), phase: z.enum(['creating', 'created', 'starting', 'started', 'stopping', 'stopped', 'removing', 'removed']),
  containerID: z.string().regex(/^[a-f0-9]{64}$/).optional(), wrapperPID: z.number().int().positive().max(0xffffffff).optional(),
  peer: peerSchema.optional() }).refine(value => value.phase === 'creating' || !!value.containerID);
const commandDigest = command => createHash('sha256').update(JSON.stringify(command)).digest('hex');
const label = 'org.turnlink.mcp.owner';

// This is an opt-in local-only runtime, not a verifier for arbitrary MCP owners
// or remote work. Its state file records intent before container create/start.
export class CodexContainedMcp {
  #file; #lock; #spec; #docker; #env; #localEndpoint; #operationID; #wrapperPID; #peer; #closed = false; #compromised = false; #busy = false;
  constructor({ directory, spec, docker, operationID, wrapperPID, peer }) {
    if (typeof directory !== 'string' || !isAbsolute(directory) || typeof docker !== 'string' || !isAbsolute(docker)) throw unavailable();
    this.#spec = specSchema.parse(spec); this.#docker = docker;
    this.#operationID = operationID === undefined ? undefined : z.string().uuid().parse(operationID);
    this.#wrapperPID = wrapperPID === undefined ? undefined : z.number().int().positive().max(0xffffffff).parse(wrapperPID);
    this.#peer = peer === undefined ? undefined : peerSchema.parse(peer);
    this.#env = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'SSL_CERT_FILE']
      .filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]]));
    privateDirectory(directory); this.#file = join(directory, `${this.#spec.resourceID}.json`); this.#lock = join(directory, `${this.#spec.resourceID}.writer`);
  }
  async #call(args, { distinguishMissingExecutable = false } = {}) {
    try {
      if (this.#closed || this.#compromised) throw unavailable();
      const output = (await exec(this.#docker, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, env: this.#env })).stdout.trim();
      if (this.#closed || this.#compromised) throw unavailable();
      return output;
    }
    catch (error) {
      // ENOENT from spawn itself proves that no Docker process was created.
      // An exited process, timeout, or lost response remains uncertain.
      if (distinguishMissingExecutable && error?.code === 'ENOENT' && error?.syscall === `spawn ${this.#docker}`)
        throw Object.assign(new Error('CONTAINED_MCP_NOT_DISPATCHED'), { code: 'CONTAINED_MCP_NOT_DISPATCHED' });
      throw unavailable();
    }
  }
  async #daemon() {
    if (!this.#localEndpoint) {
      const endpoint = this.#env.DOCKER_HOST || await this.#call(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
      let parsed;
      try { parsed = new URL(endpoint); } catch { throw unavailable(); }
      if (parsed.protocol !== 'unix:' || parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !isAbsolute(parsed.pathname)) throw unavailable();
      this.#localEndpoint = endpoint; this.#env.DOCKER_HOST = endpoint; delete this.#env.DOCKER_CONTEXT;
    }
    const value = await this.#call(['info', '--format', '{{.ID}}']);
    if (!value || value.length > 256 || /\s/.test(value)) throw unavailable();
    return value;
  }
  #load() {
    if (this.#closed || this.#compromised) throw unavailable();
    const record = recordSchema.parse(JSON.parse(readPrivate(this.#file, 65536)));
    if (record.resourceID !== this.#spec.resourceID || (this.#operationID && record.operationID !== this.#operationID) ||
        (this.#wrapperPID && record.wrapperPID !== this.#wrapperPID) ||
        (this.#peer && JSON.stringify(record.peer) !== JSON.stringify(this.#peer)) ||
        record.image !== this.#spec.image || record.commandDigest !== commandDigest(this.#spec.command)) throw unavailable();
    return record;
  }
  #save(value) { if (this.#closed || this.#compromised) throw unavailable(); const record = recordSchema.parse(value); atomicWrite(this.#file, JSON.stringify(record)); return record; }
  #checkIdentity(record, value) {
    if (value === undefined) return;
    const expected = capturedIdentity.parse(value);
    if (record.resourceID !== expected.resourceID || record.operationID !== expected.operationID ||
        record.containerID !== expected.containerID || record.wrapperPID !== expected.wrapperPID ||
        expected.daemonID !== undefined && record.daemonID !== expected.daemonID) throw unavailable();
  }
  async #inspect(record) {
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    const result = JSON.parse(await this.#call(['inspect', record.containerID || record.name]));
    if (!Array.isArray(result) || result.length !== 1) throw unavailable();
    const item = result[0], host = item.HostConfig, config = item.Config;
    if (!/^[a-f0-9]{64}$/.test(item.Id || '') || (record.containerID && item.Id !== record.containerID) ||
        item.Name !== `/${record.name}` || item.Image !== record.image || config?.Labels?.[label] !== record.operationID ||
        JSON.stringify(config?.Cmd) !== JSON.stringify(this.#spec.command) || config?.OpenStdin !== true ||
        host?.NetworkMode !== 'none' || host.Privileged !== false || host.ReadonlyRootfs !== true ||
        host.PidMode !== '' || host.IpcMode !== 'private' || host.UsernsMode !== '' || host.RestartPolicy?.Name !== 'no' || host.PidsLimit !== 128 ||
        (host.CapAdd || []).length !== 0 || (host.Devices || []).length !== 0 || (host.DeviceRequests || []).length !== 0 ||
        Object.keys(item.NetworkSettings?.Networks || {}).some(name => name !== 'none') ||
        !Array.isArray(host.CapDrop) || !host.CapDrop.includes('ALL') || !Array.isArray(host.SecurityOpt) ||
        !host.SecurityOpt.includes('no-new-privileges') || !Array.isArray(item.Mounts) || item.Mounts.length !== 0 ||
        !Array.isArray(host.Binds || []) || (host.Binds || []).length !== 0 || !item.State || typeof item.State.Running !== 'boolean') throw unavailable();
    return { id: item.Id, status: item.State.Status, running: item.State.Running };
  }
  async #absent(record) {
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    const matches = await this.#call(['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${record.containerID}`]);
    if (await this.#daemon() !== record.daemonID) throw unavailable();
    return matches === '';
  }
  async #exclusive(operation) {
    if (this.#closed || this.#compromised || this.#busy) throw unavailable();
    this.#busy = true; let unlock;
    try { unlock = acquireStore(this.#lock, () => { this.#compromised = true; }); const result = await operation(); if (this.#compromised) throw unavailable(); return result; }
    finally { unlock?.(); this.#busy = false; }
  }
  async create() {
    return this.#exclusive(async () => {
      try { this.#load(); throw unavailable(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const operationID = this.#operationID || randomUUID(), name = `turnlink-mcp-${operationID}`, daemonID = await this.#daemon();
      let record = this.#save({ version: 1, resourceID: this.#spec.resourceID, operationID, daemonID, image: this.#spec.image,
        commandDigest: commandDigest(this.#spec.command), name, phase: 'creating', ...(this.#wrapperPID ? { wrapperPID: this.#wrapperPID } : {}),
        ...(this.#peer ? { peer: this.#peer } : {}) });
      let id;
      try {
        id = await this.#call(['create', '--interactive', '--pull=never', '--name', name, '--label', `${label}=${operationID}`,
          '--network=none', '--ipc=private', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--restart=no',
          this.#spec.image, ...this.#spec.command]);
        if (!/^[a-f0-9]{64}$/.test(id)) throw uncertain();
        const observed = await this.#inspect({ ...record, containerID: id });
        if (observed.running || observed.status !== 'created') throw uncertain();
        record = this.#save({ ...record, containerID: id, phase: 'created' });
        return { resourceID: record.resourceID, operationID, containerID: id };
      } catch { throw uncertain(); }
    });
  }
  // A lost create reply can be observed by the exact persisted name and label;
  // absence or daemon uncertainty is never treated as permission to create again.
  async observe() {
    return this.#exclusive(async () => {
      let record = this.#load();
      if (record.phase === 'removing' || record.phase === 'removed') {
        if (!await this.#absent(record)) throw uncertain();
        if (record.phase === 'removing') record = this.#save({ ...record, phase: 'removed' });
        return { resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID,
          phase: record.phase, status: 'removed', running: false, ...(record.wrapperPID ? { wrapperPID: record.wrapperPID } : {}) };
      }
      let observed = await this.#inspect(record);
      if (record.phase === 'creating') {
        if (observed.running || observed.status !== 'created') throw unavailable();
        record = this.#save({ ...record, containerID: observed.id, phase: 'created' });
      }
      if (record.phase === 'starting' && observed.running) record = this.#save({ ...record, phase: 'started' });
      return { resourceID: record.resourceID, operationID: record.operationID, containerID: observed.id,
        phase: record.phase, status: observed.status, running: observed.running, ...(record.wrapperPID ? { wrapperPID: record.wrapperPID } : {}) };
    });
  }
  async start() {
    return this.#exclusive(async () => {
      let record = this.#load(); if (record.phase !== 'created') throw unavailable();
      const before = await this.#inspect(record); if (before.running || before.status !== 'created') throw unavailable();
      record = this.#save({ ...record, phase: 'starting' });
      const child = spawn(this.#docker, ['start', '--attach', '--interactive', record.containerID], { stdio: ['pipe', 'pipe', 'pipe'], env: this.#env });
      child.stdin.on('error', () => {}); child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
      const exited = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', () => resolve({ code: null, signal: null, error: 'CONTAINED_MCP_UNAVAILABLE' })); });
      // Dispatch is durable before spawn. No restart of an uncertain start.
      return Object.freeze({ child, exited, resourceID: record.resourceID, containerID: record.containerID });
    });
  }
  async stop() {
    return this.#stop();
  }
  async stopExact(expected) {
    return this.#stop(capturedIdentity.parse(expected));
  }
  async #stop(expected) {
    return this.#exclusive(async () => {
      let record = this.#load();
      this.#checkIdentity(record, expected);
      if (expected && ['removing', 'removed'].includes(record.phase)) {
        if (!await this.#absent(record)) throw uncertain();
        if (record.phase === 'removing') record = this.#save({ ...record, phase: 'removed' });
        return { resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID, status: 'removed_local' };
      }
      if (!['starting', 'started', 'stopping', 'stopped'].includes(record.phase)) throw unavailable();
      let current = await this.#inspect(record);
      if (record.phase !== 'stopped') {
        if (record.phase === 'stopping' && current.running) throw uncertain();
        if (record.phase !== 'stopping') {
          const previousPhase = record.phase;
          record = this.#save({ ...record, phase: 'stopping' });
          if (current.running) {
            try { await this.#call(['stop', '--time', '2', record.containerID], { distinguishMissingExecutable: true }); }
            catch (error) {
              if (error.code === 'CONTAINED_MCP_NOT_DISPATCHED') {
                this.#save({ ...record, phase: previousPhase });
                throw unavailable();
              }
              throw uncertain();
            }
          }
        }
        current = await this.#inspect(record);
        if (current.running || current.status !== 'exited') throw uncertain();
        record = this.#save({ ...record, phase: 'stopped' });
      }
      if (current.running || current.status !== 'exited') throw unavailable();
      return { resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID, status: 'stopped_local' };
    });
  }
  // Pins one running wrapper's journal for a private, read-only correlation.
  // Neither the PID nor this lease proves liveness after the last revalidation.
  async acquireRunningObservation({ signal } = {}) {
    if (this.#closed || this.#compromised || this.#busy || !signal || signal.aborted ||
        typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') throw unavailable();
    this.#busy = true;
    let unlock, record, released = false, invalidated = false;
    const release = () => {
      if (released) return;
      released = true; signal.removeEventListener('abort', release);
      try { unlock?.(); } finally { this.#busy = false; }
    };
    const check = () => {
      if (released || invalidated || signal.aborted || this.#closed || this.#compromised) throw unavailable();
      try { if (JSON.stringify(this.#load()) !== JSON.stringify(record)) throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    const revalidate = async () => {
      check();
      try { const state = await this.#inspect(record); check();
        if (state.id !== record.containerID || !state.running || state.status !== 'running') throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    try {
      unlock = acquireStore(this.#lock, () => { this.#compromised = true; });
      record = this.#load();
      if (!['starting', 'started'].includes(record.phase) || !record.wrapperPID) throw unavailable();
      signal.addEventListener('abort', release, { once: true });
      if (signal.aborted) throw unavailable();
      await revalidate();
      return Object.freeze({ resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID,
        wrapperPID: record.wrapperPID, daemonID: record.daemonID, ...(record.peer ? { peer: Object.freeze({ ...record.peer }) } : {}), check, revalidate, release });
    } catch (error) { release(); throw error; }
  }
  // Holds this resource's cooperative journal lock while an operator inspects
  // an already stopped container. This is not a broker verifier lease: Docker
  // state can change independently between an asynchronous check and a commit.
  async acquireStoppedObservation({ signal } = {}) {
    if (this.#closed || this.#compromised || this.#busy || !signal || signal.aborted ||
        typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') throw unavailable();
    this.#busy = true;
    let unlock, record, released = false, invalidated = false;
    const release = () => {
      if (released) return;
      released = true; signal.removeEventListener('abort', release);
      try { unlock?.(); } finally { this.#busy = false; }
    };
    const check = () => {
      if (released || invalidated || signal.aborted || this.#closed || this.#compromised) throw unavailable();
      try { if (JSON.stringify(this.#load()) !== JSON.stringify(record)) throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    const revalidate = async () => {
      check();
      try { const state = await this.#inspect(record); check();
        if (state.id !== record.containerID || state.running || state.status !== 'exited') throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    try {
      unlock = acquireStore(this.#lock, () => { this.#compromised = true; });
      record = this.#load();
      if (record.phase !== 'stopped') throw unavailable();
      signal.addEventListener('abort', release, { once: true });
      if (signal.aborted) throw unavailable();
      await revalidate();
      return Object.freeze({ resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID,
        check, revalidate, release });
    } catch (error) { release(); throw error; }
  }
  // Durable removal intent is written before dispatch. A successor may observe
  // an absent exact container after a lost reply but never repeats the remove.
  // This local observation is not a complete native MCP or broker proof.
  async retire() {
    return this.#retire();
  }
  async retireExact(expected) {
    return this.#retire(capturedIdentity.parse(expected));
  }
  async #retire(expected) {
    return this.#exclusive(async () => {
      let record = this.#load();
      this.#checkIdentity(record, expected);
      if (record.phase === 'stopped' || record.phase === 'created') {
        const current = await this.#inspect(record);
        if (current.running || (record.phase === 'stopped' ? current.status !== 'exited' : current.status !== 'created')) throw unavailable();
        const previousPhase = record.phase;
        record = this.#save({ ...record, phase: 'removing' });
        try { await this.#call(['rm', record.containerID], { distinguishMissingExecutable: true }); }
        catch (error) {
          if (error.code === 'CONTAINED_MCP_NOT_DISPATCHED') {
            this.#save({ ...record, phase: previousPhase });
            throw unavailable();
          }
          throw uncertain();
        }
      } else if (!['removing', 'removed'].includes(record.phase)) throw unavailable();
      if (!await this.#absent(record)) throw uncertain();
      if (record.phase !== 'removed') record = this.#save({ ...record, phase: 'removed' });
      return { resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID, status: 'removed_local' };
    });
  }
  // Pins the durable tombstone and cooperatively excludes another journal
  // writer while a trusted caller inspects this one removed container. Docker
  // absence is asynchronous, so this object is not a broker verifier lease.
  async acquireRetiredObservation({ signal, expected } = {}) {
    if (this.#closed || this.#compromised || this.#busy || !signal || signal.aborted ||
        typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') throw unavailable();
    this.#busy = true;
    let unlock, record, released = false, invalidated = false;
    const release = () => {
      if (released) return;
      released = true; signal.removeEventListener('abort', release);
      try { unlock?.(); } finally { this.#busy = false; }
    };
    const check = () => {
      if (released || invalidated || signal.aborted || this.#closed || this.#compromised) throw unavailable();
      try { if (JSON.stringify(this.#load()) !== JSON.stringify(record)) throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    const revalidate = async () => {
      check();
      try { const absent = await this.#absent(record); check(); if (!absent) throw unavailable(); }
      catch { invalidated = true; throw unavailable(); }
      return true;
    };
    try {
      unlock = acquireStore(this.#lock, () => { this.#compromised = true; });
      record = this.#load();
      this.#checkIdentity(record, expected);
      if (record.phase !== 'removed') throw unavailable();
      signal.addEventListener('abort', release, { once: true });
      if (signal.aborted) throw unavailable();
      await revalidate();
      return Object.freeze({ resourceID: record.resourceID, operationID: record.operationID, containerID: record.containerID,
        ...(record.wrapperPID ? { wrapperPID: record.wrapperPID } : {}),
        check, revalidate, release });
    } catch (error) { release(); throw error; }
  }
  // Use the durable removal intent even for a never-started container.
  async remove() {
    await this.#retire();
    this.#closed = true;
  }
}
