import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, fsyncSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { acquireStore, assertPrivateFile, privateDirectory } from '../storage.js';
import { UUID, Stamp, Event, Notice, Action, CommandResult, validateControlState } from './contracts.js';
import { HostID } from '../protocol.js';
import { ExportDescriptor } from './storage-contracts.js';
import { Activity, ActivityStatus } from './telemetry-contracts.js';
import { requireControl as check } from './policy.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const Header = z.strictObject({ kind: z.literal('header'), format: z.literal('turnlink-control-export-v1'), id: UUID, createdAt: Stamp,
  schemaVersion: z.union([z.literal(4), z.literal(5)]), scope: z.literal('control-only'), includesAuthentication: z.literal(false), includesCollaboration: z.literal(true) });
const Footer = z.strictObject({ kind: z.literal('footer'), id: UUID, records: Stamp, contentBytes: Stamp, contentDigest: digest });
const commandReceipt = z.strictObject({ id: UUID, fingerprint: digest, result: CommandResult });
const validators = {
  state: validateControlState,
  event: value => z.strictObject({ sequence: Stamp, event: Event }).parse(value),
  command: value => { const receipt = commandReceipt.parse(value); check(receipt.id === receipt.result.commandID, 'CONTROL_EXPORT_INVALID'); return receipt; },
  notice: value => z.strictObject({ sequence: Stamp, notice: Notice }).parse(value),
  effect_intent: value => Action.refine(a => a.status === 'executing').parse(value),
  credential_audit: value => z.strictObject({ sequence: Stamp, hostId: HostID, action: z.enum(['enrolled', 'revoked']), at: Stamp }).parse(value),
  activity: value => z.strictObject({ sequence: Stamp, activity: Activity }).parse(value),
  activity_status: value => ActivityStatus.parse(value),
};
const validateRecord = row => {
  check(row && typeof row === 'object' && Object.keys(row).length === 2 && Object.hasOwn(row, 'value') && Object.hasOwn(validators, row.kind), 'CONTROL_EXPORT_INVALID');
  return { kind: row.kind, value: validators[row.kind](row.value) };
};
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.nlink === 1;
const syncDirectory = directory => {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
};

// Immutable operator exports, not a backup of broker/security JSON and never a
// lifecycle import API. Creating or downloading one does not prune live evidence.
export class ControlArchives {
  constructor(directory, { countLimit = 32, byteLimit = 512 * 1024 * 1024, fileByteLimit = 256 * 1024 * 1024 } = {}) {
    check([countLimit, byteLimit, fileByteLimit].every(v => Number.isSafeInteger(v) && v > 0), 'INVALID_CONTROL_LIMIT');
    privateDirectory(directory); Object.assign(this, { directory, countLimit, byteLimit, fileByteLimit }); this.cache = new Map();
  }
  path(id) { return join(this.directory, `${UUID.parse(id)}.jsonl`); }
  usage() {
    privateDirectory(this.directory);
    let bytes = 0, count = 0;
    for (const file of readdirSync(this.directory)) {
      check(/^[a-f0-9-]{36}\.jsonl$/i.test(file) && UUID.safeParse(file.slice(0, -6)).success, 'CONTROL_EXPORT_INVALID');
      const stat = assertPrivateFile(join(this.directory, file)); check(stat.nlink === 1, 'CONTROL_EXPORT_INSECURE');
      bytes += stat.size; count++;
    }
    check(Number.isSafeInteger(bytes), 'CONTROL_EXPORT_INVALID'); return { count, bytes, countLimit: this.countLimit, byteLimit: this.byteLimit };
  }
  open(id) {
    privateDirectory(this.directory);
    const file = this.path(id), stat = assertPrivateFile(file);
    check(stat.nlink === 1 && stat.size <= this.fileByteLimit, 'CONTROL_EXPORT_INSECURE');
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!sameFile(stat, fstatSync(fd))) { closeSync(fd); check(false, 'CONTROL_EXPORT_CHANGED'); }
    return { fd, stat };
  }
  describe(id) {
    const { fd, stat } = this.open(id);
    try {
      const cached = this.cache.get(id);
      if (cached && sameFile(cached.stat, stat)) return cached.descriptor;
      const hash = createHash('sha256'), content = createHash('sha256'), chunk = Buffer.alloc(65536);
      const decode = new TextDecoder('utf-8', { fatal: true });
      let pieces = [], pendingBytes = 0, header, footer, records = 0, bytes = 0, stateRecords = 0;
      const append = part => {
        pendingBytes += part.length;
        check(pendingBytes <= 64 * 1024 * 1024 + 65536, 'CONTROL_EXPORT_INVALID');
        pieces.push(Buffer.from(part));
      };
      const consume = line => {
        check(!footer, 'CONTROL_EXPORT_INVALID');
        const row = JSON.parse(decode.decode(line));
        if (!header) {
          header = Header.parse(row); check(header.id === id, 'CONTROL_EXPORT_INVALID'); content.update(line); bytes += line.length;
        } else if (row.kind === 'footer') {
          footer = Footer.parse(row);
          check(footer.id === id && footer.records === records && footer.contentBytes === bytes &&
            footer.contentDigest === content.digest('hex') && stateRecords === 1, 'CONTROL_EXPORT_INVALID');
        } else {
          const record = validateRecord(row); if (record.kind === 'state') stateRecords++;
          check(stateRecords === 1, 'CONTROL_EXPORT_INVALID'); records++; content.update(line); bytes += line.length;
        }
        hash.update(line);
      };
      for (;;) {
        const n = readSync(fd, chunk, 0, chunk.length, null); if (!n) break;
        let start = 0, index;
        while ((index = chunk.indexOf(10, start)) !== -1 && index < n) {
          append(chunk.subarray(start, index + 1));
          consume(pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, pendingBytes));
          pieces = []; pendingBytes = 0; start = index + 1;
        }
        if (start < n) append(chunk.subarray(start, n));
      }
      check(!!header && !!footer && !pendingBytes, 'CONTROL_EXPORT_INCOMPLETE');
      check(sameFile(stat, fstatSync(fd)), 'CONTROL_EXPORT_CHANGED');
      const descriptor = ExportDescriptor.parse({ id, format: header.format, createdAt: header.createdAt, bytes: stat.size, digest: hash.digest('hex'), records,
        scope: header.scope, includesAuthentication: false, includesCollaboration: true });
      this.cache.set(id, { stat, descriptor }); return descriptor;
    } finally { closeSync(fd); }
  }
  create(id, createdAt, records) {
    UUID.parse(id); Stamp.parse(createdAt);
    const unlock = acquireStore(this.directory, () => { this.fault = true; });
    let fd;
    try {
      check(!this.fault, 'CONTROL_EXPORT_UNAVAILABLE');
      try { lstatSync(this.path(id)); return this.describe(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const usage = this.usage(); check(usage.count < this.countLimit, 'CONTROL_EXPORT_STORE_FULL');
      check(usage.bytes < this.byteLimit, 'CONTROL_EXPORT_STORE_FULL');
      fd = openSync(this.path(id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      const hash = createHash('sha256'); let bytes = 0, count = 0, stateRecords = 0;
      const append = row => {
        check(!this.fault, 'CONTROL_EXPORT_UNAVAILABLE');
        const line = Buffer.from(`${JSON.stringify(row)}\n`);
        check(bytes + line.length <= this.fileByteLimit && usage.bytes + bytes + line.length <= this.byteLimit, 'CONTROL_EXPORT_STORE_FULL');
        writeFileSync(fd, line); hash.update(line); bytes += line.length;
      };
      append(Header.parse({ kind: 'header', format: 'turnlink-control-export-v1', id, createdAt, schemaVersion: 5,
        scope: 'control-only', includesAuthentication: false, includesCollaboration: true }));
      for (const input of records()) {
        const row = validateRecord(input); if (row.kind === 'state') stateRecords++;
        check(stateRecords === 1, 'CONTROL_EXPORT_INVALID'); append(row); count++;
      }
      check(stateRecords === 1, 'CONTROL_EXPORT_INVALID');
      append({ kind: 'footer', id, records: count, contentBytes: bytes, contentDigest: hash.copy().digest('hex') });
      fsyncSync(fd); closeSync(fd); fd = undefined; syncDirectory(this.directory);
      const descriptor = ExportDescriptor.parse({ id, format: 'turnlink-control-export-v1', createdAt, bytes, digest: hash.digest('hex'), records: count,
        scope: 'control-only', includesAuthentication: false, includesCollaboration: true });
      this.cache.set(id, { stat: assertPrivateFile(this.path(id)), descriptor }); return descriptor;
    } finally { if (fd !== undefined) closeSync(fd); unlock(); }
  }
  read(id, offset, limit = 24576) {
    check(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 24576, 'CONTROL_EXPORT_OFFSET');
    const descriptor = this.describe(id); check(offset <= descriptor.bytes, 'CONTROL_EXPORT_OFFSET');
    const { fd, stat } = this.open(id);
    try {
      const cached = this.cache.get(id); check(cached && sameFile(cached.stat, stat), 'CONTROL_EXPORT_CHANGED');
      const data = Buffer.alloc(Math.min(limit, descriptor.bytes - offset));
      const read = readSync(fd, data, 0, data.length, offset);
      check(read === data.length && sameFile(stat, fstatSync(fd)), 'CONTROL_EXPORT_CHANGED');
      return { id, offset, next: offset + read, totalBytes: descriptor.bytes, digest: descriptor.digest, data: data.toString('base64') };
    } finally { closeSync(fd); }
  }
}
