import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { acquireStore, privateDirectory, assertPrivateFile } from '../storage.js';
import { Command, CommandResult, Context, Action, Event, Notice, Stamp, UUID, MASTER_PROMPT_VERSION, freshControlState, validateControlState, RETENTION_MS, ChannelPrecondition, channelPrecondition } from './contracts.js';
import { HostID, Channel, AgentID } from '../protocol.js';
import { reduceControl } from './reducer.js';
import { ControlError, requireControl as check, masterInstructions } from './policy.js';
import { pressureLevel } from './storage-contracts.js';
import { Activity, ActivityStatus } from './telemetry-contracts.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseNotice = row => {
  check(Buffer.byteLength(row.body) <= 8192, 'INVALID_NOTICE_RECORD');
  const notice = Notice.parse(JSON.parse(row.body));
  check(notice.id === row.id && notice.channel === row.channel && notice.agentId === row.agent_id &&
    notice.assignmentID === row.assignment_id && notice.status === row.status, 'INVALID_NOTICE_RECORD');
  return notice;
};
const parseActivity = row => {
  check(Buffer.byteLength(row.body) <= 2048, 'INVALID_ACTIVITY_RECORD');
  const value = Activity.parse(JSON.parse(row.body));
  check(value.id === row.id && value.at === row.at && value.channel === row.channel && (value.messageID ?? null) === row.message_id, 'INVALID_ACTIVITY_RECORD');
  return value;
};

// Internal single-writer repository. No browser/agent transport is exposed by this module.
export class ControlStore {
  constructor(directory, { eventLimit = 100000, commandLimit = 10000, stateByteLimit = 64 * 1024 * 1024,
    beforeCommit = () => {}, noticeLimit = 8192, diskStats = statfsSync, telemetryLimit = 20000 } = {}) {
    check([eventLimit, commandLimit, stateByteLimit, noticeLimit, telemetryLimit].every(value => Number.isSafeInteger(value) && value > 0), 'INVALID_CONTROL_LIMIT');
    privateDirectory(directory);
    this.fault = false; this.closed = false;
    this.unlock = acquireStore(directory, () => { this.fault = true; });
    this.eventLimit = eventLimit; this.commandLimit = commandLimit; this.stateByteLimit = stateByteLimit; this.beforeCommit = beforeCommit;
    this.noticeLimit = noticeLimit;
    this.directory = directory; this.diskStats = diskStats;
    this.telemetryLimit = telemetryLimit;
    const path = join(directory, 'control.db');
    try {
      try { closeSync(openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      let stat;
      try { stat = assertPrivateFile(path); } catch { throw new ControlError('INSECURE_CONTROL_DATABASE'); }
      check(stat.nlink === 1, 'INSECURE_CONTROL_DATABASE');
      this.db = new DatabaseSync(path);
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      check([0, 1, 2, 3, 4, 5].includes(version), 'UNSUPPORTED_CONTROL_SCHEMA');
      if (version === 0) check(this.db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table'").get().total === 0, 'UNKNOWN_CONTROL_DATABASE');
      else this.snapshot(); // Reject unknown/corrupt state before changing journal mode or performing migrations.
      // Configure durability before the first schema/state transaction, not after bootstrapping.
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE control_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
          CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
          CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            channel TEXT NOT NULL, at INTEGER NOT NULL, durable INTEGER NOT NULL, body TEXT NOT NULL);
          CREATE INDEX events_channel_sequence ON events(channel, sequence);
          PRAGMA user_version=1;`);
        this.db.prepare('INSERT INTO control_state VALUES(1, ?)').run(JSON.stringify(freshControlState()));
        this.db.exec('COMMIT');
      }
      if (version < 2) {
        this.snapshot(); // Validate old state before migrating; do not repair unknown/corrupt input.
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE adapter_credentials (host_id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL);
          CREATE TABLE notices (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            channel TEXT NOT NULL, agent_id TEXT NOT NULL, assignment_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
          CREATE INDEX notices_recipient ON notices(channel, agent_id, status, sequence);
          PRAGMA user_version=2; COMMIT;`);
      }
      if (version < 3) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE credential_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, host_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('enrolled','revoked')), at INTEGER NOT NULL);
        PRAGMA user_version=3; COMMIT;`);
      if (version < 4) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE effect_intents (id TEXT PRIMARY KEY, channel TEXT NOT NULL, body TEXT NOT NULL);
        PRAGMA user_version=4; COMMIT;`);
      if (version < 5) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE activity (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
          channel TEXT NOT NULL, message_id TEXT, at INTEGER NOT NULL, body TEXT NOT NULL);
        CREATE INDEX activity_channel_sequence ON activity(channel, sequence);
        CREATE INDEX activity_at ON activity(at);
        CREATE TABLE activity_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_at INTEGER NOT NULL,
          last_pruned_at INTEGER NOT NULL, rejected INTEGER NOT NULL);
        INSERT INTO activity_meta VALUES(1,0,0,0);
        PRAGMA user_version=5; COMMIT;`);
      // Bound total database size. WAL is checkpointed after batches and private directory permissions protect sidecars.
      this.db.exec('PRAGMA max_page_count=32768; PRAGMA wal_autocheckpoint=100;');
      this.snapshot();
    } catch (error) { try { this.db?.close(); } finally { this.unlock(); } throw error; }
  }
  available() { check(!this.closed && !this.fault, 'CONTROL_STORE_UNAVAILABLE'); }
  transaction(callback) {
    this.available(); this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.beforeCommit(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { this.fault = true; } throw error; }
  }
  snapshot() {
    this.available();
    const row = this.db.prepare('SELECT body FROM control_state WHERE singleton=1').get();
    check(!!row, 'CONTROL_STATE_MISSING');
    check(Buffer.byteLength(row.body) <= this.stateByteLimit, 'CONTROL_STATE_FULL'); return validateControlState(JSON.parse(row.body));
  }
  apply(input, suppliedContext, expected) {
    this.available();
    const command = Command.parse(input), context = Context.parse(suppliedContext);
    if (expected !== undefined) { check(context.actor.kind === 'operator', 'OPERATOR_REQUIRED'); expected = ChannelPrecondition.parse(expected); }
    const fingerprint = hash({ command, actor: context.actor });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT fingerprint, result FROM commands WHERE id=?').get(command.id);
      if (prior) {
        check(prior.fingerprint === fingerprint, 'COMMAND_IDEMPOTENCY_CONFLICT');
        this.db.exec('COMMIT'); return { ...JSON.parse(prior.result), replayed: true };
      }
      check(this.db.prepare('SELECT count(*) AS total FROM commands').get().total < this.commandLimit, 'COMMAND_RECEIPTS_FULL');
      const previous = this.snapshot();
      if (expected !== undefined) {
        const channel = previous.channels.find(c => c.id === command.channel);
        check(channel && JSON.stringify(channelPrecondition(channel)) === JSON.stringify(expected), 'PRECONDITION_FAILED');
      }
      const { state, events } = reduceControl(previous, command, context);
      const body = JSON.stringify(state); check(Buffer.byteLength(body) <= this.stateByteLimit, 'CONTROL_STATE_FULL');
      this.db.prepare('DELETE FROM events WHERE durable=0 AND at < ?').run(context.now - RETENTION_MS);
      check(this.db.prepare('SELECT count(*) AS total FROM events').get().total + events.length <= this.eventLimit, 'CONTROL_EVENT_STORE_FULL');
      this.db.prepare('UPDATE control_state SET body=? WHERE singleton=1').run(body);
      const insert = this.db.prepare('INSERT INTO events(id, channel, at, durable, body) VALUES(?,?,?,?,?)');
      for (const event of events) insert.run(event.id, event.channel, event.at, event.durable ? 1 : 0, JSON.stringify(event));
      this.enqueueNotices(previous, state, events);
      for (const event of events.filter(e => e.type === 'action.executing')) {
        const value = state.actions.find(a => a.id === event.entityID);
        this.db.prepare('INSERT INTO effect_intents VALUES(?,?,?)').run(value.id, value.channel, JSON.stringify(value));
      }
      // Persist a bounded receipt rather than a full state snapshot for every command.
      const result = { commandID: command.id, channel: command.channel, eventIDs: events.map(e => e.id) };
      this.db.prepare('INSERT INTO commands(id, fingerprint, result) VALUES(?,?,?)').run(command.id, fingerprint, JSON.stringify(result));
      this.beforeCommit(); this.db.exec('COMMIT'); return { ...result, replayed: false };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { this.fault = true; }
      throw error;
    }
  }
  events(channel, { after = 0, limit = 100 } = {}) {
    this.available();
    check(Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_EVENT_PAGE');
    const rows = this.db.prepare('SELECT sequence, body FROM events WHERE channel=? AND sequence>? ORDER BY sequence LIMIT ?').all(channel, after, limit);
    return { entries: rows.map(row => ({ sequence: row.sequence, ...Event.parse(JSON.parse(row.body)) })), next: rows.at(-1)?.sequence ?? after };
  }
  commandReceipt(channel, commandID) {
    this.available(); Channel.parse(channel); UUID.parse(commandID);
    const row = this.db.prepare('SELECT result FROM commands WHERE id=?').get(commandID);
    if (!row) return { known: false, commandID, channel };
    check(Buffer.byteLength(row.result) <= 1024 * 1024, 'INVALID_COMMAND_RECEIPT');
    const result = CommandResult.parse(JSON.parse(row.result));
    check(result.commandID === commandID, 'INVALID_COMMAND_RECEIPT');
    if (result.channel !== channel) return { known: false, commandID, channel };
    return { known: true, commandID, channel, eventCount: result.eventIDs.length, eventIDs: result.eventIDs.slice(0, 100), digest: hash(result) };
  }
  effectIntents() {
    this.available();
    return this.db.prepare('SELECT * FROM effect_intents ORDER BY rowid').all().map(row => {
      check(Buffer.byteLength(row.body) <= 4096, 'INVALID_EFFECT_INTENT');
      const value = Action.parse(JSON.parse(row.body));
      check(value.id === row.id && value.channel === row.channel && value.status === 'executing', 'INVALID_EFFECT_INTENT');
      return value;
    });
  }
  enqueueNotices(previous, state, events) {
    const notices = events.filter(e => ['master.proposed', 'master.activated', 'master.ended', 'task.reported', 'task.stopped'].includes(e.type));
    for (const event of events.filter(e => e.type === 'master.activated')) {
      for (const task of state.tasks.filter(t => t.channel === event.channel && t.status === 'review' && t.stoppedEvidence))
        notices.push({ ...event, id: randomUUID(), entityID: task.id, type: 'task.reported' });
    }
    for (const source of notices) {
      const event = source.type === 'task.stopped' ? { ...source, type: 'task.reported' } : source;
      if (event.type === 'task.reported' && !state.tasks.some(t => t.id === event.entityID && t.status === 'review' && t.stoppedEvidence)) continue;
      const priorChannel = previous.channels.find(c => c.id === event.channel), nextChannel = state.channels.find(c => c.id === event.channel);
      const assignment = event.type === 'task.reported' ? nextChannel?.active : [priorChannel?.active, priorChannel?.proposal, nextChannel?.active, nextChannel?.proposal]
        .find(value => value?.id === event.entityID) || (event.agentId ? { id: event.entityID, agentId: event.agentId,
          generation: event.generation, promptVersion: MASTER_PROMPT_VERSION } : undefined);
      if (event.type === 'task.reported' && !assignment) continue;
      check(!!assignment, 'NOTICE_ASSIGNMENT_MISSING');
      if (event.type === 'master.ended') {
        for (const row of this.db.prepare("SELECT * FROM notices WHERE assignment_id=? AND status='pending'").all(assignment.id)) {
          const cancelled = Notice.parse({ ...parseNotice(row), status: 'cancelled' });
          this.db.prepare('UPDATE notices SET status=?, body=? WHERE id=?').run('cancelled', JSON.stringify(cancelled), row.id);
        }
      }
      check(this.db.prepare('SELECT count(*) AS total FROM notices').get().total < this.noticeLimit, 'CONTROL_NOTICE_STORE_FULL');
      const kind = { 'master.proposed': 'offer', 'master.activated': 'active', 'master.ended': 'ended', 'task.reported': 'task_review' }[event.type];
      const task = kind === 'task_review' ? state.tasks.find(t => t.id === event.entityID) : undefined;
      const text = kind === 'task_review' ? 'Turnlink task ready for master review. Inspect the task criteria, participant report and adapter evidence via channel_status. Accept or reject using task.review only after review; a stopped execution and artifact reference do not independently prove correctness. Preserve all existing project/global instructions and permissions.\nTASK_REVIEW_DATA\n' +
        JSON.stringify({ taskID: task.id, evidenceID: task.result.evidence[0], generation: assignment.generation }) : kind === 'offer' ? masterInstructions(assignment, event.channel) :
        `Turnlink supplemental role notice: assignment ${assignment.id}, channel ${event.channel}, generation ${assignment.generation} is ${kind === 'active' ? 'active' : 'inactive'}. ` +
        'Your existing global/project instructions, agent, model, tools and project permissions remain unchanged. Do not automatically reply to this notice. Broker authorization determines current authority.';
      const notice = Notice.parse({ id: event.id, channel: event.channel, agentId: assignment.agentId, assignmentID: assignment.id,
        generation: assignment.generation, promptVersion: assignment.promptVersion, kind, text, at: event.at, status: 'pending' });
      this.db.prepare('INSERT INTO notices(id, channel, agent_id, assignment_id, status, body) VALUES(?,?,?,?,?,?)')
        .run(notice.id, notice.channel, notice.agentId, notice.assignmentID, notice.status, JSON.stringify(notice));
    }
  }
  notices(channel, agentId, { after = 0, limit = 20 } = {}) {
    this.available(); Channel.parse(channel); AgentID.parse(agentId); Stamp.parse(after);
    check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_NOTICE_PAGE');
    const rows = this.db.prepare("SELECT * FROM notices WHERE channel=? AND agent_id=? AND status='pending' AND sequence>? ORDER BY sequence LIMIT ?")
      .all(channel, agentId, after, limit);
    return { entries: rows.map(row => ({ sequence: row.sequence, ...parseNotice(row) })), next: rows.at(-1)?.sequence ?? after };
  }
  acceptNotice(channel, agentId, noticeID, receiptID, now = Date.now()) {
    this.available(); Channel.parse(channel); AgentID.parse(agentId); UUID.parse(noticeID);
    Stamp.parse(now);
    check(typeof receiptID === 'string' && /^msg_[a-zA-Z0-9_-]{1,124}$/.test(receiptID), 'INVALID_NOTICE_RECEIPT');
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM notices WHERE id=? AND channel=? AND agent_id=?').get(noticeID, channel, agentId);
      check(!!row, 'UNKNOWN_NOTICE'); const notice = parseNotice(row);
      check(notice.status !== 'cancelled', 'NOTICE_CANCELLED');
      if (notice.status === 'accepted') { check(notice.receiptID === receiptID, 'NOTICE_RECEIPT_CONFLICT'); return; }
      check(this.db.prepare('SELECT count(*) AS total FROM events').get().total < this.eventLimit, 'CONTROL_EVENT_STORE_FULL');
      const event = Event.parse({ id: randomUUID(), channel, type: 'notice.accepted', entityID: notice.id, generation: notice.generation,
        actor: { kind: 'adapter', agentId }, at: now, durable: true });
      this.db.prepare('INSERT INTO events(id, channel, at, durable, body) VALUES(?,?,?,?,?)').run(event.id, channel, now, 1, JSON.stringify(event));
      notice.status = 'accepted'; notice.receiptID = receiptID;
      this.db.prepare('UPDATE notices SET status=?, body=? WHERE id=?').run('accepted', JSON.stringify(notice), noticeID);
    });
  }
  offerAccepted(channel, agentId, assignmentID) {
    this.available();
    return this.db.prepare("SELECT * FROM notices WHERE channel=? AND agent_id=? AND assignment_id=? AND status='accepted'")
      .all(channel, agentId, assignmentID).some(row => parseNotice(row).kind === 'offer');
  }
  recordMessageAccess(channel, actor, messageID, now, generation) {
    this.available();
    const event = Event.parse({ id: randomUUID(), channel, type: 'messages.viewed', actor, entityID: messageID, at: now,
      ...(generation !== undefined ? { generation } : {}), durable: true });
    this.transaction(() => {
      check(this.db.prepare('SELECT count(*) AS total FROM events').get().total < this.eventLimit, 'CONTROL_EVENT_STORE_FULL');
      this.db.prepare('INSERT INTO events(id, channel, at, durable, body) VALUES(?,?,?,?,?)').run(event.id, channel, now, 1, JSON.stringify(event));
    });
  }
  enrollAdapter(hostId, credentialDigest, now = Date.now()) {
    this.available(); HostID.parse(hostId);
    Stamp.parse(now);
    check(typeof credentialDigest === 'string' && /^[a-f0-9]{64}$/.test(credentialDigest), 'INVALID_ADAPTER_CREDENTIAL');
    this.transaction(() => {
      check(this.db.prepare('SELECT count(*) AS total FROM credential_audit').get().total < 4096, 'CREDENTIAL_AUDIT_FULL');
      this.db.prepare('INSERT INTO adapter_credentials VALUES(?,?) ON CONFLICT(host_id) DO UPDATE SET digest=excluded.digest').run(hostId, credentialDigest);
      this.db.prepare('INSERT INTO credential_audit(host_id, action, at) VALUES(?,?,?)').run(hostId, 'enrolled', now);
    });
  }
  adapterDigest(hostId) { this.available(); return this.db.prepare('SELECT digest FROM adapter_credentials WHERE host_id=?').get(HostID.parse(hostId))?.digest; }
  recordActivity(input, missed = 0) {
    const row = Activity.parse(input); Stamp.parse(missed);
    return this.transaction(() => {
      const meta = this.db.prepare('SELECT * FROM activity_meta WHERE singleton=1').get();
      check(row.at >= meta.last_at, 'CLOCK_REGRESSION');
      this.db.prepare('UPDATE activity_meta SET last_at=?, rejected=min(rejected+?, 9007199254740991) WHERE singleton=1').run(row.at, missed);
      if (this.db.prepare('SELECT count(*) AS total FROM activity').get().total >= this.telemetryLimit) {
        this.db.prepare('UPDATE activity_meta SET rejected=min(rejected+1, 9007199254740991) WHERE singleton=1').run();
        return false; // Durable loss counter; never evict unresolved or unexpired rows to admit new telemetry.
      }
      this.db.prepare('INSERT INTO activity(id,channel,message_id,at,body) VALUES(?,?,?,?,?)')
        .run(row.id, row.channel, row.messageID ?? null, row.at, JSON.stringify(row));
      return true;
    });
  }
  pruneActivity(now, protectedMessageIDs, missed = 0) {
    Stamp.parse(now); Stamp.parse(missed);
    check(Array.isArray(protectedMessageIDs) && protectedMessageIDs.length <= 40000, 'INVALID_ACTIVITY_PROTECTION');
    const ids = [...new Set(protectedMessageIDs.map(id => UUID.parse(id)))];
    return this.transaction(() => {
      const meta = this.db.prepare('SELECT * FROM activity_meta WHERE singleton=1').get();
      check(now >= meta.last_at && now >= meta.last_pruned_at, 'CLOCK_REGRESSION');
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS activity_pins (id TEXT PRIMARY KEY); DELETE FROM activity_pins;');
      const pin = this.db.prepare('INSERT INTO activity_pins VALUES(?)'); for (const id of ids) pin.run(id);
      const result = this.db.prepare(`DELETE FROM activity WHERE at < ? AND
        (message_id IS NULL OR NOT EXISTS (SELECT 1 FROM activity_pins WHERE id=activity.message_id))`).run(now - RETENTION_MS);
      this.db.exec('DELETE FROM activity_pins;');
      this.db.prepare('UPDATE activity_meta SET last_pruned_at=?, last_at=?, rejected=min(rejected+?, 9007199254740991) WHERE singleton=1').run(now, now, missed);
      return result.changes;
    });
  }
  activityStatus() {
    this.available();
    const totals = this.db.prepare('SELECT count(*) AS rows, min(at) AS oldestAt, max(at) AS newestAt FROM activity').get();
    const meta = this.db.prepare('SELECT * FROM activity_meta WHERE singleton=1').get();
    return ActivityStatus.parse({ ...totals, limit: this.telemetryLimit, lastPrunedAt: meta.last_pruned_at, rejected: meta.rejected });
  }
  activity(channel, { after = 0, limit = 100 } = {}) {
    this.available(); Channel.parse(channel); Stamp.parse(after);
    check(Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_EVENT_PAGE');
    const rows = this.db.prepare('SELECT * FROM activity WHERE channel=? AND sequence>? ORDER BY sequence LIMIT ?').all(channel, after, limit);
    return { entries: rows.map(row => ({ sequence: row.sequence, ...parseActivity(row) })), next: rows.at(-1)?.sequence ?? after };
  }
  storageStatus() {
    this.available();
    const state = this.snapshot(), quotas = [];
    const quota = (resource, used, limit) => quotas.push({ resource, used, limit, level: pressureLevel(used, limit) });
    for (const [resource, limit] of [['events', this.eventLimit], ['commands', this.commandLimit], ['notices', this.noticeLimit], ['credential_audit', 4096]])
      quota(resource, this.db.prepare(`SELECT count(*) AS total FROM ${resource}`).get().total, limit);
    quota('state_bytes', this.db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM control_state WHERE singleton=1').get().bytes, this.stateByteLimit);
    const pages = this.db.prepare('PRAGMA page_count').get().page_count;
    const freePages = this.db.prepare('PRAGMA freelist_count').get().freelist_count;
    quota('database_pages', pages - freePages, this.db.prepare('PRAGMA max_page_count').get().max_page_count);
    for (const [name, limit] of [['evidence', 16384], ['tasks', 4096], ['actions', 4096], ['incidents', 4096], ['previews', 4096], ['transitions', 4096]])
      quota(name, state[name].length, limit);
    const disk = this.diskStats(this.directory), availableBytes = disk.bavail * disk.bsize, totalBytes = disk.blocks * disk.bsize;
    check(Number.isSafeInteger(availableBytes) && Number.isSafeInteger(totalBytes) && availableBytes >= 0 && totalBytes > 0 && availableBytes <= totalBytes, 'CONTROL_STORAGE_UNAVAILABLE');
    quotas.push({ resource: 'disk', used: totalBytes - availableBytes, limit: totalBytes,
      level: availableBytes < Math.max(16 * 1024 * 1024, totalBytes * 0.02) ? 'critical' : availableBytes < Math.max(64 * 1024 * 1024, totalBytes * 0.05) ? 'warning' : 'ok' });
    return { quotas, disk: { availableBytes, totalBytes }, unresolved: {
      tasks: state.tasks.filter(t => !['completed', 'cancelled'].includes(t.status)).length,
      actions: state.actions.filter(a => !['succeeded', 'failed', 'rejected'].includes(a.status)).length,
      incidents: state.incidents.filter(i => i.status === 'open').length,
      transitions: state.transitions.filter(t => ['prepared', 'uncertain'].includes(t.status)).length,
    } };
  }
  exportTo(archives, id, now) {
    this.available(); UUID.parse(id); Stamp.parse(now);
    this.db.exec('BEGIN');
    try {
      const store = this;
      const descriptor = archives.create(id, now, function* () {
        yield { kind: 'state', value: store.snapshot() };
        for (const row of store.db.prepare('SELECT sequence, body FROM events ORDER BY sequence').iterate())
          yield { kind: 'event', value: { sequence: row.sequence, event: Event.parse(JSON.parse(row.body)) } };
        for (const row of store.db.prepare('SELECT id, fingerprint, result FROM commands ORDER BY rowid').iterate())
          yield { kind: 'command', value: { id: row.id, fingerprint: row.fingerprint, result: JSON.parse(row.result) } };
        for (const row of store.db.prepare('SELECT * FROM notices ORDER BY sequence').iterate())
          yield { kind: 'notice', value: { sequence: row.sequence, notice: parseNotice(row) } };
        for (const row of store.db.prepare('SELECT body FROM effect_intents ORDER BY rowid').iterate())
          yield { kind: 'effect_intent', value: Action.parse(JSON.parse(row.body)) };
        // Credential audit is exportable; authentication digests/registries are deliberately not selected.
        for (const row of store.db.prepare('SELECT sequence, host_id, action, at FROM credential_audit ORDER BY sequence').iterate())
          yield { kind: 'credential_audit', value: { sequence: row.sequence, hostId: row.host_id, action: row.action, at: row.at } };
        for (const row of store.db.prepare('SELECT * FROM activity ORDER BY sequence').iterate())
          yield { kind: 'activity', value: { sequence: row.sequence, activity: parseActivity(row) } };
        yield { kind: 'activity_status', value: store.activityStatus() };
      });
      this.db.exec('COMMIT'); return descriptor;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { this.fault = true; } throw error; }
  }
  revokeAdapter(hostId, now = Date.now()) {
    this.available(); HostID.parse(hostId); Stamp.parse(now);
    this.transaction(() => {
      check(this.db.prepare('SELECT count(*) AS total FROM credential_audit').get().total < 4096, 'CREDENTIAL_AUDIT_FULL');
      this.db.prepare('DELETE FROM adapter_credentials WHERE host_id=?').run(hostId);
      this.db.prepare('INSERT INTO credential_audit(host_id, action, at) VALUES(?,?,?)').run(hostId, 'revoked', now);
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { try { this.db.close(); } finally { this.unlock(); } }
  }
}
