import { usesProviderEstablishment, usesProviderCleanup, usesProviderModelContext, usesProviderReconciliation, usesProviderCatalog } from './provider-establishment-contracts.js';
import { usesMcpEstablishment, usesMcpBindingCapture, usesMcpPluginCapture, usesMcpSkillCapture, usesMcpStepPreparation } from './mcp-establishment-contracts.js';
import { transitionHoldsConversation } from './worktree-holds.js';
import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { acquireStore, privateDirectory, assertPrivateFile } from '../storage.js';
import { Command, CommandResult, Context, Action, Event, Notice, Stamp, UUID, MASTER_PROMPT_VERSION, freshControlState, validateControlState, RETENTION_MS, ChannelPrecondition, channelPrecondition, TaskPrecondition, taskPrecondition, usesDestinationOwners, usesDestinationCancellation, usesSourceMcpShutdown, usesSourceModelShutdown, usesContainedSourceRetirement, usesSessionPreparation } from './contracts.js';
import { HostID, Channel, AgentID } from '../protocol.js';
import { reduceControl } from './reducer.js';
import { ControlError, requireControl as check, masterInstructions } from './policy.js';
import { pressureLevel, ReclamationRequest, ReclamationResult, HistoryReclamationRequest, HistoryReclamationResult } from './storage-contracts.js';
import { ControlArchives } from './archives.js';
import { ARCHIVED_TEXT, taskPayload, putTaskPayload, compactTask, protectedHistory, HISTORY_KINDS, entityLimit } from './history.js';
import { Activity, ActivityStatus } from './telemetry-contracts.js';
import { StoredHealth } from './health.js';
import { NotificationType, OperatorNotification } from './notification-contracts.js';
import { CheckpointObservation } from './checkpoint-observation.js';
import { CheckpointDestination, CheckpointGuestReceipt } from './checkpoint-destination.js';
import { usesModernManagedRecords } from './worktree-lifecycle-contracts.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseHealth = row => {
  check(Buffer.byteLength(row.body) <= 4096, 'INVALID_ADAPTER_HEALTH');
  const record = StoredHealth.parse(JSON.parse(row.body));
  check(record.agentId === row.agent_id && record.channel === row.channel && record.observedAt === row.observed_at, 'INVALID_ADAPTER_HEALTH');
  return record;
};
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
const notificationTypes = NotificationType.options;
const notificationFilter = `e.durable=1 AND json_extract(e.body, '$.type') IN (${notificationTypes.map(() => '?').join(',')})`;
const parseNotification = row => {
  check(Buffer.byteLength(row.body) <= 8192, 'INVALID_NOTIFICATION_RECORD');
  const event = Event.parse(JSON.parse(row.body));
  check(event.id === row.id && event.channel === row.channel && event.at === row.at && event.durable, 'INVALID_NOTIFICATION_RECORD');
  return OperatorNotification.parse({ id: event.id, channel: event.channel, sequence: row.sequence,
    type: event.type, at: event.at, ...(event.entityID ? { entityID: event.entityID } : {}), acknowledgedAt: row.acknowledged_at ?? null });
};

// Internal single-writer repository. No browser/agent transport is exposed by this module.
export class ControlStore {
  constructor(directory, { eventLimit = 100000, commandLimit = 10000, stateByteLimit = 64 * 1024 * 1024,
    beforeCommit = () => {}, noticeLimit = 8192, diskStats = statfsSync, telemetryLimit = 20000, notificationAckLimit = 8192, archivedCommandLimit = 100000,
    archivedHistoryLimit = 100000, hydratedStateByteLimit = stateByteLimit * 2, exportLimits } = {}) {
    check([eventLimit, commandLimit, stateByteLimit, noticeLimit, telemetryLimit, notificationAckLimit, archivedCommandLimit, archivedHistoryLimit, hydratedStateByteLimit].every(value => Number.isSafeInteger(value) && value > 0) && hydratedStateByteLimit >= stateByteLimit, 'INVALID_CONTROL_LIMIT');
    privateDirectory(directory);
    this.fault = false; this.closed = false;
    this.unlock = acquireStore(directory, () => { this.fault = true; });
    this.eventLimit = eventLimit; this.commandLimit = commandLimit; this.stateByteLimit = stateByteLimit; this.beforeCommit = beforeCommit;
    this.noticeLimit = noticeLimit;
    this.directory = directory; this.diskStats = diskStats;
    this.telemetryLimit = telemetryLimit;
    this.notificationAckLimit = notificationAckLimit;
    this.archivedCommandLimit = archivedCommandLimit;
    this.archivedHistoryLimit = archivedHistoryLimit; this.hydratedStateByteLimit = hydratedStateByteLimit;
    const path = join(directory, 'control.db');
    try {
      try { closeSync(openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      let stat;
      try { stat = assertPrivateFile(path); } catch { throw new ControlError('INSECURE_CONTROL_DATABASE'); }
      check(stat.nlink === 1, 'INSECURE_CONTROL_DATABASE');
      this.db = new DatabaseSync(path);
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      check([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36].includes(version), 'UNSUPPORTED_CONTROL_SCHEMA');
      if (version < 33 && this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='checkpoint_observations'").get().n)
        check(this.db.prepare('SELECT count(*) AS n FROM checkpoint_observations').get().n === 0, 'UNSUPPORTED_CONTROL_SCHEMA');
      if (version < 34 && this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='checkpoint_destinations'").get().n)
        check(this.db.prepare('SELECT count(*) AS n FROM checkpoint_destinations').get().n === 0, 'UNSUPPORTED_CONTROL_SCHEMA');
      this.historyReady = version >= 16;
      this.coldReady = version >= 17;
      this.receiptArchives = new ControlArchives(join(directory, 'exports'), exportLimits);
      if (version === 0) check(this.db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table'").get().total === 0, 'UNKNOWN_CONTROL_DATABASE');
      else { const previous = this.snapshot(); check(version >= 18 || !usesProviderEstablishment(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 19 || !usesProviderCleanup(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 20 || !usesProviderModelContext(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 21 || !usesProviderReconciliation(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 22 || !usesProviderCatalog(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 23 || !usesMcpEstablishment(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 24 || !usesMcpBindingCapture(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 25 || !usesMcpPluginCapture(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 26 || !usesMcpSkillCapture(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 27 || !usesMcpStepPreparation(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 28 || !usesDestinationOwners(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 29 || !usesDestinationCancellation(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 30 || !usesSourceMcpShutdown(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 31 || !usesSourceModelShutdown(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); check(version >= 32 || !usesContainedSourceRetirement(previous), 'UNSUPPORTED_CONTROL_SCHEMA'); } // Reject unknown/corrupt state before changing journal mode or performing migrations.
      if (version > 0 && version < 35) check(!usesSessionPreparation(this.snapshot()), 'UNSUPPORTED_CONTROL_SCHEMA');
      if (version > 0 && version < 36) check(!usesModernManagedRecords(this.snapshot()), 'UNSUPPORTED_CONTROL_SCHEMA');
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
      // New bounded lifecycle records live in the existing transactional state
      // snapshot. Old snapshots default to an empty collection, never rewritten
      // during migration; old binaries must refuse the new schema version.
      if (version < 6) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=6; COMMIT;');
      if (version < 7) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE adapter_health (agent_id TEXT PRIMARY KEY, channel TEXT NOT NULL, observed_at INTEGER NOT NULL, body TEXT NOT NULL);
        CREATE INDEX adapter_health_channel ON adapter_health(channel);
        CREATE INDEX adapter_health_at ON adapter_health(observed_at);
        PRAGMA user_version=7; COMMIT;`);
      if (version < 8) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE notification_acks (event_id TEXT PRIMARY KEY REFERENCES events(id), acknowledged_at INTEGER NOT NULL CHECK(acknowledged_at>=0));
        PRAGMA user_version=8; COMMIT;`);
      // Structured review-notice task identity is additive; old rows are retained,
      // never guessed into a current eligibility/ownership grant.
      if (version < 9) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=9; COMMIT;');
      if (version < 10) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=10; COMMIT;');
      if (version < 11) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=11; COMMIT;');
      // Preserve old bytes and receipts. Zero means no post-upgrade uncertainty
      // ordering observation, not authentication or native proof freshness.
      if (version < 12) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=12; COMMIT;');
      // Older reducers must not admit pre-uncertainty admission/start/progress
      // callbacks against a task whose explicit uncertainty advanced its epoch.
      if (version < 13) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=13; COMMIT;');
      if (version < 14) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=14; COMMIT;');
      if (version < 15) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS receipt_archives (id TEXT PRIMARY KEY, digest TEXT NOT NULL, reclaimed INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS archived_commands (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES receipt_archives(id));
        PRAGMA user_version=15; COMMIT;`);
      if (version < 16) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS history_reclamations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, before_at INTEGER NOT NULL,
          events INTEGER NOT NULL, notices INTEGER NOT NULL, task_payloads INTEGER NOT NULL, state_bytes_freed INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS archived_events (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES history_reclamations(id));
        CREATE TABLE IF NOT EXISTS archived_notices (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES history_reclamations(id));
        CREATE TABLE IF NOT EXISTS archived_task_payloads (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES history_reclamations(id));
        PRAGMA user_version=16; COMMIT;`);
      this.historyReady = true;
      if (version < 17) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS archived_entities (kind TEXT NOT NULL, id TEXT NOT NULL, archive_id TEXT NOT NULL REFERENCES history_reclamations(id), body TEXT NOT NULL,
          PRIMARY KEY(kind,id)); PRAGMA user_version=17; COMMIT;`);
      if (version < 18) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=18; COMMIT;');
      if (version < 19) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=19; COMMIT;');
      if (version < 20) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=20; COMMIT;');
      if (version < 21) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=21; COMMIT;');
      if (version < 22) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=22; COMMIT;');
      if (version < 23) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=23; COMMIT;');
      if (version < 26) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=26; COMMIT;');
      if (version < 27) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=27; COMMIT;');
      if (version < 28) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=28; COMMIT;');
      if (version < 29) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=29; COMMIT;');
      if (version < 30) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=30; COMMIT;');
      if (version < 31) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=31; COMMIT;');
      if (version < 32) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=32; COMMIT;');
      if (version < 33) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS checkpoint_observations (request_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL,
          generation TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
          UNIQUE(transition_id, generation, revision)); PRAGMA user_version=33; COMMIT;`);
      if (version < 34) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS checkpoint_destinations (request_id TEXT PRIMARY KEY, vm_instance TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
        PRAGMA user_version=34; COMMIT;`);
      if (version < 35) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=35; COMMIT;');
      if (version < 36) this.db.exec('BEGIN IMMEDIATE; PRAGMA user_version=36; COMMIT;');
      const checkpointRows = this.db.prepare('SELECT request_id,transition_id,generation,revision,body FROM checkpoint_observations').all();
      check(checkpointRows.length <= 4096, 'CHECKPOINT_OBSERVATIONS_FULL');
      for (const row of checkpointRows) {
        check(Buffer.byteLength(row.body) <= 8192, 'INVALID_CHECKPOINT_OBSERVATION');
        const value = CheckpointObservation.parse(JSON.parse(row.body));
        check(value.requestID === row.request_id && value.transitionID === row.transition_id &&
          value.metadata.reservation.generation === row.generation && value.metadata.reservation.revision === row.revision,
        'INVALID_CHECKPOINT_OBSERVATION');
      }
      const destinationRows = this.db.prepare('SELECT request_id,vm_instance,body FROM checkpoint_destinations').all();
      check(destinationRows.length <= 4096, 'CHECKPOINT_DESTINATIONS_FULL');
      for (const row of destinationRows) {
        check(Buffer.byteLength(row.body) <= 8192, 'INVALID_CHECKPOINT_DESTINATION');
        const value = CheckpointDestination.parse(JSON.parse(row.body));
        check(value.requestID === row.request_id && value.vmInstance === row.vm_instance &&
          this.checkpointObservation(value.requestID)?.transitionID === value.transitionID &&
          this.checkpointObservation(value.requestID)?.metadata.digest === value.checkpointDigest, 'INVALID_CHECKPOINT_DESTINATION');
      }
      this.coldReady = true;
      // Bound total database size. WAL is checkpointed after batches and private directory permissions protect sidecars.
      this.db.exec('PRAGMA max_page_count=32768; PRAGMA wal_autocheckpoint=100;');
      this.snapshot();
      // A missing/corrupt archive is lost idempotency evidence, never permission
      // to reopen mutation admission after a restart.
      for (const row of this.db.prepare('SELECT id, digest FROM receipt_archives').all()) this.receiptArchives.commands(row.id, row.digest);
      this.verifyHistoryArchives();
      for (const archive of this.db.prepare('SELECT id,digest FROM history_reclamations').all()) {
        const entries = this.db.prepare('SELECT kind,id,body FROM archived_entities WHERE archive_id=?').all(archive.id);
        if (!entries.length) continue;
        const records = this.receiptArchives.records(archive.id, archive.digest);
        const originals = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, new Map(records.state[kind].map(value => [value.id, value]))]));
        for (const entry of entries) {
          if (entry.kind === 'credential_audit') check(JSON.stringify(records.credentialAudit.get(Number(entry.id))) === entry.body, 'CONTROL_HISTORY_RECORD_CHANGED');
          else check(originals[entry.kind]?.has(entry.id), 'CONTROL_HISTORY_RECORD_MISSING');
        }
      }
      this.historyRows('archived_events', 'events'); this.historyRows('archived_events', 'notificationAcks'); this.historyRows('archived_notices', 'notices');
    } catch (error) { try { this.db?.close(); } finally { this.unlock(); } throw error; }
  }
  available() { check(!this.closed && !this.fault, 'CONTROL_STORE_UNAVAILABLE'); }
  checkpointObservation(requestID) {
    this.available(); UUID.parse(requestID);
    const row = this.db.prepare('SELECT request_id,transition_id,generation,revision,body FROM checkpoint_observations WHERE request_id=?').get(requestID);
    if (!row) return undefined;
    check(Buffer.byteLength(row.body) <= 8192, 'INVALID_CHECKPOINT_OBSERVATION');
    const value = CheckpointObservation.parse(JSON.parse(row.body));
    check(value.requestID === row.request_id && value.transitionID === row.transition_id && value.metadata.reservation.generation === row.generation &&
      value.metadata.reservation.revision === row.revision, 'INVALID_CHECKPOINT_OBSERVATION');
    return value;
  }
  checkpointDestination(requestID) {
    this.available(); UUID.parse(requestID);
    const row = this.db.prepare('SELECT request_id,vm_instance,body FROM checkpoint_destinations WHERE request_id=?').get(requestID);
    if (!row) return undefined;
    check(Buffer.byteLength(row.body) <= 8192, 'INVALID_CHECKPOINT_DESTINATION');
    const value = CheckpointDestination.parse(JSON.parse(row.body)), source = this.checkpointObservation(requestID);
    check(value.requestID === row.request_id && value.vmInstance === row.vm_instance && source?.transitionID === value.transitionID &&
      source.metadata.digest === value.checkpointDigest, 'INVALID_CHECKPOINT_DESTINATION');
    return value;
  }
  beginCheckpointDestination(input, assertCurrent) {
    const value = CheckpointDestination.parse(input);
    check(value.status === 'pending' && typeof assertCurrent === 'function', 'CHECKPOINT_DESTINATION_UNAVAILABLE');
    this.available(); this.verifyHistoryArchives(); this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.checkpointDestination(value.requestID);
      if (previous) {
        check(previous.transitionID === value.transitionID && previous.vmInstance === value.vmInstance &&
          previous.checkpointDigest === value.checkpointDigest, 'CHECKPOINT_DESTINATION_CONFLICT');
        this.db.exec('COMMIT'); return { destination: previous, historical: true };
      }
      const source = this.checkpointObservation(value.requestID);
      check(source?.transitionID === value.transitionID && source.metadata.digest === value.checkpointDigest, 'CHECKPOINT_DESTINATION_UNAVAILABLE');
      assertCurrent();
      check(this.db.prepare('SELECT count(*) AS n FROM checkpoint_destinations').get().n < 4096, 'CHECKPOINT_DESTINATIONS_FULL');
      check(!this.db.prepare('SELECT request_id FROM checkpoint_destinations WHERE vm_instance=?').get(value.vmInstance), 'CHECKPOINT_DESTINATION_CONFLICT');
      this.db.prepare('INSERT INTO checkpoint_destinations VALUES(?,?,?)').run(value.requestID, value.vmInstance, JSON.stringify(value));
      this.beforeCommit(); assertCurrent(); this.db.exec('COMMIT');
      return { destination: value, historical: false };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { this.fault = true; } throw error; }
  }
  finishCheckpointDestination(requestID, inputReceipt, now, assertCurrent) {
    const receipt = CheckpointGuestReceipt.parse(inputReceipt); Stamp.parse(now);
    check(typeof assertCurrent === 'function', 'CHECKPOINT_DESTINATION_UNAVAILABLE');
    this.available(); this.verifyHistoryArchives(); this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.checkpointDestination(requestID);
      check(previous?.status === 'pending' && now >= previous.startedAt, 'CHECKPOINT_DESTINATION_UNAVAILABLE');
      const value = CheckpointDestination.parse({ ...previous, status: 'quarantined', receipt, finishedAt: now });
      assertCurrent(); this.db.prepare('UPDATE checkpoint_destinations SET body=? WHERE request_id=?').run(JSON.stringify(value), requestID);
      this.beforeCommit(); assertCurrent(); this.db.exec('COMMIT'); return value;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { this.fault = true; } throw error; }
  }
  markCheckpointDestinationUncertain(requestID, now) {
    Stamp.parse(now);
    return this.transaction(() => {
      const previous = this.checkpointDestination(requestID);
      if (!previous || previous.status !== 'pending') return previous;
      const value = CheckpointDestination.parse({ ...previous, status: 'uncertain', finishedAt: Math.max(now, previous.startedAt) });
      this.db.prepare('UPDATE checkpoint_destinations SET body=? WHERE request_id=?').run(JSON.stringify(value), requestID);
      return value;
    });
  }
  // Stores only an observation. A historical replay never revives a lease.
  recordCheckpointObservation(input, assertCurrent) {
    this.available(); this.verifyHistoryArchives();
    const value = CheckpointObservation.parse(input);
    check(typeof assertCurrent === 'function', 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
    const stable = record => { const { recordedAt, ...rest } = record; return JSON.stringify(rest); };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.checkpointObservation(value.requestID);
      if (prior) {
        check(stable(prior) === stable(value), 'CHECKPOINT_OBSERVATION_CONFLICT');
        this.db.exec('COMMIT'); return { observation: prior, historical: true };
      }
      assertCurrent();
      check(this.db.prepare('SELECT count(*) AS n FROM checkpoint_observations').get().n < 4096, 'CHECKPOINT_OBSERVATIONS_FULL');
      check(!this.db.prepare('SELECT request_id FROM checkpoint_observations WHERE transition_id=? AND generation=? AND revision=?')
        .get(value.transitionID, value.metadata.reservation.generation, value.metadata.reservation.revision), 'CHECKPOINT_OBSERVATION_CONFLICT');
      this.db.prepare('INSERT INTO checkpoint_observations VALUES(?,?,?,?,?)').run(value.requestID, value.transitionID,
        value.metadata.reservation.generation, value.metadata.reservation.revision, JSON.stringify(value));
      this.beforeCommit(); assertCurrent(); this.db.exec('COMMIT');
      return { observation: value, historical: false };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { this.fault = true; }
      throw error;
    }
  }
  transaction(callback) {
    this.available(); this.verifyHistoryArchives(); this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.beforeCommit(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { this.fault = true; } throw error; }
  }
  snapshot(recordCache = new Map()) {
    this.available();
    const row = this.db.prepare('SELECT body FROM control_state WHERE singleton=1').get();
    check(!!row, 'CONTROL_STATE_MISSING');
    check(Buffer.byteLength(row.body) <= this.stateByteLimit, 'CONTROL_STATE_FULL');
    const state = JSON.parse(row.body);
    for (const kind of HISTORY_KINDS) {
      state[kind] ??= [];
      check(Array.isArray(state[kind]) && state[kind].length <= entityLimit(kind), 'CONTROL_HOT_ENTITY_STORE_FULL');
    }
    const coldCounts = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, 0]));
    const present = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, new Set((state[kind] || []).map(value => value.id))]));
    let coldAuditCount = 0;
    if (this.coldReady) for (const entry of this.db.prepare('SELECT kind,id,body FROM archived_entities ORDER BY rowid').all()) {
      if (entry.kind === 'credential_audit') {
        check(++coldAuditCount <= 4096 && Number.isSafeInteger(Number(entry.id)) && Number(entry.id) > 0 && String(Number(entry.id)) === entry.id && Buffer.byteLength(entry.body) <= 4096, 'CONTROL_HISTORY_METADATA_INVALID');
        continue;
      }
      check(HISTORY_KINDS.includes(entry.kind) && Buffer.byteLength(entry.body) <= 128 * 1024, 'CONTROL_HISTORY_METADATA_INVALID');
      const value = JSON.parse(entry.body); check(value.id === entry.id && !present[entry.kind].has(entry.id), 'CONTROL_HISTORY_METADATA_INVALID');
      check(++coldCounts[entry.kind] <= entityLimit(entry.kind), 'ARCHIVED_ENTITY_STORE_FULL');
      state[entry.kind].push(value); present[entry.kind].add(entry.id);
    }
    const tasks = new Map(state.tasks.map(task => [task.id, task]));
    if (this.historyReady) for (const [id, payload] of this.archivedTaskPayloads(recordCache)) {
      const task = tasks.get(id);
      check(task && ['completed', 'cancelled'].includes(task.status) && task.title === ARCHIVED_TEXT && task.instructions === ARCHIVED_TEXT && task.criteria === ARCHIVED_TEXT &&
        (payload.summary === undefined ? !task.result : task.result?.summary === ARCHIVED_TEXT), 'CONTROL_HISTORY_PAYLOAD_INVALID');
      putTaskPayload(task, payload);
    }
    check(Buffer.byteLength(JSON.stringify(state)) <= this.hydratedStateByteLimit, 'CONTROL_HYDRATED_STATE_FULL');
    return validateControlState(state, { allowArchiveExpansion: this.coldReady });
  }
  verifyHistoryArchives() {
    if (!this.historyReady) return;
    for (const row of this.db.prepare('SELECT id, digest FROM history_reclamations').all())
      check(this.receiptArchives.describe(row.id).digest === row.digest, 'CONTROL_ARCHIVE_DIGEST_MISMATCH');
  }
  historyRows(table, kind, recordCache = new Map()) {
    const result = new Map();
    for (const archive of this.db.prepare('SELECT id, digest FROM history_reclamations ORDER BY rowid').all()) {
      const ids = this.db.prepare(`SELECT id FROM ${table} WHERE archive_id=? ${kind === 'credentialAudit' ? "AND kind='credential_audit'" : ''} ORDER BY rowid`).all(archive.id);
      if (!ids.length) continue;
      if (!recordCache.has(archive.id)) recordCache.set(archive.id, this.receiptArchives.records(archive.id, archive.digest));
      const records = recordCache.get(archive.id);
      const tasks = kind === 'tasks' ? new Map(records.state.tasks.map(task => [task.id, task])) : undefined;
      for (const row of ids) {
        if (kind === 'notificationAcks' && !notificationTypes.includes(records.events.get(row.id)?.event.type)) continue;
        const record = kind === 'tasks' ? tasks.get(row.id) : records[kind].get(kind === 'credentialAudit' ? Number(row.id) : row.id);
        check(!!record, 'CONTROL_HISTORY_RECORD_MISSING'); result.set(row.id, record);
      }
    }
    return result;
  }
  archivedTaskPayloads(recordCache) { return new Map([...this.historyRows('archived_task_payloads', 'tasks', recordCache)].map(([id, task]) => [id, taskPayload(task)])); }
  storedState(state, recordCache = new Map()) {
    check(Buffer.byteLength(JSON.stringify(state)) <= this.hydratedStateByteLimit, 'CONTROL_HYDRATED_STATE_FULL');
    const stored = structuredClone(state);
    const byKind = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, new Map(stored[kind].map(value => [value.id, value]))]));
    for (const [id, payload] of this.archivedTaskPayloads(recordCache)) {
      const task = byKind.tasks.get(id);
      check(task && JSON.stringify(taskPayload(task)) === JSON.stringify(payload), 'CONTROL_HISTORY_PAYLOAD_CHANGED'); compactTask(task);
    }
    const coldIDs = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, new Set()]));
    if (this.coldReady) for (const row of this.db.prepare('SELECT kind,id,body FROM archived_entities ORDER BY rowid').all()) {
      if (row.kind === 'credential_audit') continue;
      check(HISTORY_KINDS.includes(row.kind), 'CONTROL_HISTORY_METADATA_INVALID');
      const value = byKind[row.kind].get(row.id); check(value, 'CONTROL_HISTORY_METADATA_INVALID');
      const body = JSON.stringify(value); check(Buffer.byteLength(body) <= 128 * 1024, 'CONTROL_HISTORY_METADATA_INVALID');
      if (body !== row.body) this.db.prepare('UPDATE archived_entities SET body=? WHERE kind=? AND id=?').run(body, row.kind, row.id);
      coldIDs[row.kind].add(row.id);
    }
    for (const kind of HISTORY_KINDS) {
      stored[kind] = stored[kind].filter(value => !coldIDs[kind].has(value.id));
      check(stored[kind].length <= entityLimit(kind), 'CONTROL_HOT_ENTITY_STORE_FULL');
    }
    const body = JSON.stringify(stored); check(Buffer.byteLength(body) <= this.stateByteLimit, 'CONTROL_STATE_FULL'); return body;
  }
  findCommand(id) {
    const live = this.db.prepare('SELECT fingerprint, result FROM commands WHERE id=?').get(id);
    if (live) return live;
    const archived = this.db.prepare('SELECT a.id, a.digest FROM archived_commands c JOIN receipt_archives a ON a.id=c.archive_id WHERE c.id=?').get(id);
    if (!archived) return undefined;
    const receipt = this.receiptArchives.commands(archived.id, archived.digest).get(id);
    check(!!receipt, 'CONTROL_ARCHIVE_RECEIPT_MISSING');
    return { fingerprint: receipt.fingerprint, result: JSON.stringify(receipt.result) };
  }
  reclaimReceipts(archives, input) {
    this.available();
    const request = ReclamationRequest.parse(input);
    // The durable index always resolves against the store's private archive
    // directory. Never accept an arbitrary external file as future authority.
    check(archives.directory === this.receiptArchives.directory, 'CONTROL_ARCHIVE_DIRECTORY_MISMATCH');
    const receipts = archives.commands(request.id, request.digest);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT digest, reclaimed FROM receipt_archives WHERE id=?').get(request.id);
      if (prior) {
        check(prior.digest === request.digest, 'CONTROL_ARCHIVE_DIGEST_MISMATCH');
        return ReclamationResult.parse({ ...request, reclaimed: prior.reclaimed, replayed: true });
      }
      const eligible = this.db.prepare('SELECT id, fingerprint, result FROM commands').all().filter(row => {
        const receipt = receipts.get(row.id);
        if (!receipt) return false;
        check(receipt.fingerprint === row.fingerprint && JSON.stringify(receipt.result) === row.result, 'CONTROL_ARCHIVE_RECEIPT_MISMATCH');
        return true;
      });
      check(eligible.length > 0, 'CONTROL_ARCHIVE_NOTHING_TO_RECLAIM');
      check(this.db.prepare('SELECT count(*) AS total FROM archived_commands').get().total + eligible.length <= this.archivedCommandLimit, 'ARCHIVED_COMMAND_INDEX_FULL');
      this.db.prepare('INSERT INTO receipt_archives VALUES(?,?,?)').run(request.id, request.digest, eligible.length);
      const insert = this.db.prepare('INSERT INTO archived_commands VALUES(?,?)'), remove = this.db.prepare('DELETE FROM commands WHERE id=?');
      for (const receipt of eligible) { insert.run(receipt.id, request.id); remove.run(receipt.id); }
      return ReclamationResult.parse({ ...request, reclaimed: eligible.length, replayed: false });
    });
  }
  reclaimHistory(archives, input, now) {
    this.available(); const request = HistoryReclamationRequest.parse(input); Stamp.parse(now);
    check(archives.directory === this.receiptArchives.directory, 'CONTROL_ARCHIVE_DIRECTORY_MISMATCH');
    check(request.before <= now - RETENTION_MS, 'CONTROL_HISTORY_RETENTION');
    const records = archives.records(request.id, request.digest);
    const recordCache = new Map([[request.id, records]]);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM history_reclamations WHERE id=?').get(request.id);
      if (prior) {
        check(prior.digest === request.digest && prior.before_at === request.before, 'CONTROL_HISTORY_IDEMPOTENCY_CONFLICT');
        const notificationAcks = [...this.historyRows('archived_events', 'notificationAcks', recordCache).keys()].filter(id =>
          this.db.prepare('SELECT archive_id FROM archived_events WHERE id=?').get(id)?.archive_id === request.id).length;
        const entities = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, this.db.prepare('SELECT count(*) AS n FROM archived_entities WHERE kind=? AND archive_id=?').get(kind, request.id).n]));
        const credentialAudit = this.db.prepare("SELECT count(*) AS n FROM archived_entities WHERE kind='credential_audit' AND archive_id=?").get(request.id).n;
        return HistoryReclamationResult.parse({ ...request, events: prior.events, notices: prior.notices, notificationAcks, credentialAudit, entities, taskPayloads: prior.task_payloads, stateBytesFreed: prior.state_bytes_freed, replayed: true });
      }
      const state = this.snapshot(recordCache); check(now >= state.lastNow, 'CLOCK_REGRESSION');
      const notices = this.db.prepare('SELECT * FROM notices').all().map(row => ({ row, notice: parseNotice(row) }));
      const protectedState = protectedHistory(state, notices.map(value => value.notice), request.before);
      const liveEvents = this.db.prepare('SELECT sequence, body FROM events ORDER BY sequence').all().map(row => ({ sequence: row.sequence, event: Event.parse(JSON.parse(row.body)) }));
      const acknowledgements = new Map(this.db.prepare('SELECT event_id, acknowledged_at FROM notification_acks').all().map(row => [row.event_id, row.acknowledged_at]));
      const events = liveEvents.filter(row => row.event.at < request.before &&
        (!notificationTypes.includes(row.event.type) || (acknowledgements.has(row.event.id) && acknowledgements.get(row.event.id) < request.before)) &&
        !protectedState.channels.has(row.event.channel) && !protectedState.ids.has(row.event.id) && !protectedState.ids.has(row.event.entityID));
      for (const row of events) check(JSON.stringify(records.events.get(row.event.id)) === JSON.stringify(row), 'CONTROL_HISTORY_RECORD_CHANGED');
      const archivedAcks = events.filter(row => notificationTypes.includes(row.event.type));
      for (const row of archivedAcks) check(records.notificationAcks.get(row.event.id)?.acknowledgedAt === acknowledgements.get(row.event.id), 'CONTROL_HISTORY_RECORD_CHANGED');
      const settled = notices.filter(({ notice }) => notice.status !== 'pending' && notice.at < request.before &&
        !protectedState.ids.has(notice.id) && !protectedState.ids.has(notice.assignmentID) && !protectedState.ids.has(notice.taskID));
      for (const { row, notice } of settled) check(JSON.stringify(records.notices.get(notice.id)) === JSON.stringify({ sequence: row.sequence, notice }), 'CONTROL_HISTORY_RECORD_CHANGED');
      const archivedEvents = [...this.historyRows('archived_events', 'events', recordCache).values()];
      const allEvents = [...liveEvents, ...archivedEvents], latest = new Map(), terminalEvents = new Set(), latestEvidence = new Map();
      for (const row of allEvents) if (row.event.entityID) {
        latest.set(row.event.entityID, Math.max(latest.get(row.event.entityID) ?? 0, row.event.at));
        if (['task.completed', 'task.missed'].includes(row.event.type)) terminalEvents.add(row.event.entityID);
      }
      for (const row of state.evidence) latestEvidence.set(row.entityID, Math.max(latestEvidence.get(row.entityID) ?? 0, row.at));
      const payloads = state.tasks.filter(task => ['completed', 'cancelled'].includes(task.status) && !task.terminalHold && !protectedState.ids.has(task.id) &&
        !this.db.prepare('SELECT id FROM archived_task_payloads WHERE id=?').get(task.id) &&
        terminalEvents.has(task.id) && (latest.get(task.id) ?? 0) < request.before && (latestEvidence.get(task.id) ?? 0) < request.before);
      const originalTasks = new Map(records.state.tasks.map(task => [task.id, task]));
      for (const task of payloads) {
        const original = originalTasks.get(task.id);
        check(original && JSON.stringify(taskPayload(original)) === JSON.stringify(taskPayload(task)), 'CONTROL_HISTORY_PAYLOAD_CHANGED');
      }
      const eligibility = {
        tasks: value => ['completed', 'cancelled'].includes(value.status) && !value.terminalHold && terminalEvents.has(value.id) && (latestEvidence.get(value.id) ?? 0) < request.before,
        actions: value => ['succeeded', 'failed', 'rejected'].includes(value.status),
        incidents: value => value.status === 'resolved', evidence: () => true,
        previews: value => state.tasks.some(task => task.id === value.taskID && ['completed', 'cancelled'].includes(task.status)),
        transitions: value => ['moved', 'failed'].includes(value.status),
        managedPreviews: value => ['removed', 'rejected', 'failed'].includes(value.status) || (value.status === 'created' && state.managedPreviews.some(other => other.preview.resourceID === value.id && other.status === 'removed')),
      };
      const candidates = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, state[kind].filter(value => {
        const observed = Math.max(value.at ?? value.createdAt ?? value.openedAt ?? value.preparedAt ?? 0, value.settledAt ?? 0, value.resolvedAt ?? 0, latest.get(value.id) ?? 0);
        return !protectedState.ids.has(value.id) && observed < request.before && eligibility[kind](value) &&
          !this.db.prepare('SELECT id FROM archived_entities WHERE kind=? AND id=?').get(kind, value.id);
      })]));
      for (const kind of HISTORY_KINDS) {
        const originals = new Map(records.state[kind].map(row => [row.id, row]));
        for (const value of candidates[kind]) check(originals.has(value.id) && JSON.stringify(originals.get(value.id)) === JSON.stringify(value), 'CONTROL_HISTORY_RECORD_CHANGED');
      }
      const entities = Object.fromEntries(HISTORY_KINDS.map(kind => [kind, candidates[kind].length]));
      const audits = this.db.prepare('SELECT sequence,host_id,action,at FROM credential_audit WHERE at<? ORDER BY sequence').all(request.before)
        .map(row => ({ sequence: row.sequence, hostId: HostID.parse(row.host_id), action: row.action, at: Stamp.parse(row.at) }));
      for (const row of audits) check(JSON.stringify(records.credentialAudit.get(row.sequence)) === JSON.stringify(row), 'CONTROL_HISTORY_RECORD_CHANGED');
      const needed = events.length + settled.length + payloads.length + audits.length + Object.values(entities).reduce((sum, n) => sum + n, 0);
      check(needed > 0, 'CONTROL_HISTORY_NOTHING_TO_RECLAIM');
      const indexCount = ['archived_events', 'archived_notices', 'archived_task_payloads', 'archived_entities'].reduce((sum, table) => sum + this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
      check(indexCount + needed <= this.archivedHistoryLimit, 'ARCHIVED_HISTORY_INDEX_FULL');
      for (const kind of HISTORY_KINDS) check(this.db.prepare('SELECT count(*) AS n FROM archived_entities WHERE kind=?').get(kind).n + entities[kind] <= entityLimit(kind), 'ARCHIVED_ENTITY_STORE_FULL');
      check(this.db.prepare("SELECT count(*) AS n FROM archived_entities WHERE kind='credential_audit'").get().n + audits.length <= 4096, 'ARCHIVED_ENTITY_STORE_FULL');
      const previousBytes = this.db.prepare('SELECT length(CAST(body AS BLOB)) AS n FROM control_state').get().n;
      this.db.prepare('INSERT INTO history_reclamations VALUES(?,?,?,?,?,?,?)').run(request.id, request.digest, request.before, events.length, settled.length, payloads.length, 0);
      for (const row of events) {
        this.db.prepare('INSERT INTO archived_events VALUES(?,?)').run(row.event.id, request.id);
        this.db.prepare('DELETE FROM notification_acks WHERE event_id=?').run(row.event.id);
        this.db.prepare('DELETE FROM events WHERE id=?').run(row.event.id);
      }
      for (const { notice } of settled) {
        this.db.prepare('INSERT INTO archived_notices VALUES(?,?)').run(notice.id, request.id);
        this.db.prepare('DELETE FROM notices WHERE id=?').run(notice.id);
      }
      for (const task of payloads) this.db.prepare('INSERT INTO archived_task_payloads VALUES(?,?)').run(task.id, request.id);
      for (const kind of HISTORY_KINDS) for (const value of candidates[kind]) this.db.prepare('INSERT INTO archived_entities VALUES(?,?,?,?)').run(kind, value.id, request.id, JSON.stringify(value));
      for (const row of audits) {
        this.db.prepare('INSERT INTO archived_entities VALUES(?,?,?,?)').run('credential_audit', String(row.sequence), request.id, JSON.stringify(row));
        this.db.prepare('DELETE FROM credential_audit WHERE sequence=?').run(row.sequence);
      }
      const body = this.storedState(state, recordCache), stateBytesFreed = Math.max(0, previousBytes - Buffer.byteLength(body));
      this.db.prepare('UPDATE control_state SET body=? WHERE singleton=1').run(body);
      this.db.prepare('UPDATE history_reclamations SET state_bytes_freed=? WHERE id=?').run(stateBytesFreed, request.id);
      return HistoryReclamationResult.parse({ ...request, events: events.length, notices: settled.length, notificationAcks: archivedAcks.length, credentialAudit: audits.length, entities, taskPayloads: payloads.length, stateBytesFreed, replayed: false });
    });
  }
  apply(input, suppliedContext, expected, expectedTask) {
    this.available();
    this.verifyHistoryArchives();
    const command = Command.parse(input), context = Context.parse(suppliedContext);
    if (expected !== undefined) { check(context.actor.kind === 'operator', 'OPERATOR_REQUIRED'); expected = ChannelPrecondition.parse(expected); }
    if (expectedTask !== undefined) {
      check(context.actor.kind === 'operator', 'OPERATOR_REQUIRED'); expectedTask = TaskPrecondition.parse(expectedTask);
      check(['task.reassign', 'task.missed'].includes(command.op) && command.taskID === expectedTask.taskID, 'INVALID_TASK_PRECONDITION');
    }
    const fingerprint = hash({ command, actor: context.actor });
    const recordCache = new Map();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.findCommand(command.id);
      if (prior) {
        check(prior.fingerprint === fingerprint, 'COMMAND_IDEMPOTENCY_CONFLICT');
        this.db.exec('COMMIT'); return { ...JSON.parse(prior.result), replayed: true };
      }
      check(this.db.prepare('SELECT count(*) AS total FROM commands').get().total < this.commandLimit, 'COMMAND_RECEIPTS_FULL');
      const previous = this.snapshot(recordCache);
      if (command.op === 'task.create') check(JSON.parse(this.db.prepare('SELECT body FROM control_state').get().body).tasks.length < entityLimit('tasks'), 'CONTROL_HOT_ENTITY_STORE_FULL');
      if (expected !== undefined) {
        const channel = previous.channels.find(c => c.id === command.channel);
        check(channel && JSON.stringify(channelPrecondition(channel)) === JSON.stringify(expected), 'PRECONDITION_FAILED');
      }
      if (expectedTask !== undefined) {
        const task = previous.tasks.find(t => t.id === expectedTask.taskID && t.channel === command.channel);
        check(task && JSON.stringify(taskPrecondition(task)) === JSON.stringify(expectedTask), 'PRECONDITION_FAILED');
      }
      const { state, events } = reduceControl(previous, command, context, { allowArchiveExpansion: true });
      const body = this.storedState(state, recordCache);
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
  // Recover only an already committed exact command and actor. This never
  // invokes the reducer and does not authorize an undispatched effect.
  replayCommitted(input, suppliedActor) {
    this.available();
    this.verifyHistoryArchives();
    const command = Command.parse(input), context = Context.parse({ actor: suppliedActor, now: 0, members: [] });
    const prior = this.findCommand(command.id);
    if (!prior) return undefined;
    check(prior.fingerprint === hash({ command, actor: context.actor }), 'COMMAND_IDEMPOTENCY_CONFLICT');
    const result = CommandResult.parse(JSON.parse(prior.result));
    check(result.commandID === command.id && result.channel === command.channel, 'INVALID_COMMAND_RECEIPT');
    return { ...result, replayed: true };
  }
  health(channel) {
    this.available(); Channel.parse(channel);
    return this.db.prepare('SELECT * FROM adapter_health WHERE channel=? ORDER BY agent_id').all(channel).map(parseHealth);
  }
  recordHealth(input) {
    const record = StoredHealth.parse(input);
    this.transaction(() => {
      const latest = this.db.prepare('SELECT max(observed_at) AS at FROM adapter_health').get().at ?? 0;
      const clock = this.db.prepare('SELECT last_at, last_pruned_at FROM activity_meta WHERE singleton=1').get();
      check(record.observedAt >= Math.max(this.snapshot().lastNow, latest, clock.last_at, clock.last_pruned_at), 'CLOCK_REGRESSION');
      const prior = this.db.prepare('SELECT agent_id FROM adapter_health WHERE agent_id=?').get(record.agentId);
      check(prior || this.db.prepare('SELECT count(*) AS total FROM adapter_health').get().total < 4096, 'ADAPTER_HEALTH_FULL');
      this.db.prepare('INSERT INTO adapter_health VALUES(?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET channel=excluded.channel, observed_at=excluded.observed_at, body=excluded.body')
        .run(record.agentId, record.channel, record.observedAt, JSON.stringify(record));
      this.db.prepare('UPDATE activity_meta SET last_at=? WHERE singleton=1').run(record.observedAt);
    });
    return record;
  }
  pruneHealth(now, protectedAgents) {
    Stamp.parse(now);
    check(Array.isArray(protectedAgents) && protectedAgents.length <= 16384, 'INVALID_ADAPTER_HEALTH');
    protectedAgents.forEach(id => AgentID.parse(id)); const pins = new Set(protectedAgents);
    this.transaction(() => {
      const latest = this.db.prepare('SELECT max(observed_at) AS at FROM adapter_health').get().at ?? 0;
      const clock = this.db.prepare('SELECT last_at, last_pruned_at FROM activity_meta WHERE singleton=1').get();
      check(now >= Math.max(this.snapshot().lastNow, latest, clock.last_at, clock.last_pruned_at), 'CLOCK_REGRESSION');
      for (const row of this.db.prepare('SELECT * FROM adapter_health WHERE observed_at < ?').all(now - RETENTION_MS)) {
        const value = parseHealth(row);
        if (!pins.has(value.agentId)) this.db.prepare('DELETE FROM adapter_health WHERE agent_id=?').run(value.agentId);
      }
      this.db.prepare('UPDATE activity_meta SET last_at=? WHERE singleton=1').run(now);
    });
  }
  events(channel, { after = 0, limit = 100 } = {}) {
    this.available();
    check(Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_EVENT_PAGE');
    const rows = this.db.prepare('SELECT sequence, body FROM events WHERE channel=? AND sequence>? ORDER BY sequence LIMIT ?').all(channel, after, limit)
      .map(row => ({ sequence: row.sequence, event: Event.parse(JSON.parse(row.body)) }));
    const records = [...rows, ...this.historyRows('archived_events', 'events').values()].filter(row => row.event.channel === channel && row.sequence > after)
      .sort((a, b) => a.sequence - b.sequence).slice(0, limit);
    return { entries: records.map(row => ({ sequence: row.sequence, ...row.event })), next: records.at(-1)?.sequence ?? after };
  }
  notifications(channel, { after = 0, limit = 30, pendingOnly = false } = {}) {
    this.available(); Channel.parse(channel); Stamp.parse(after);
    check(Number.isInteger(limit) && limit >= 1 && limit <= 100 && typeof pendingOnly === 'boolean', 'INVALID_NOTIFICATION_PAGE');
    const rows = this.db.prepare(`SELECT e.*, a.acknowledged_at FROM events e LEFT JOIN notification_acks a ON a.event_id=e.id
      WHERE e.channel=? AND e.sequence>? AND ${notificationFilter} ${pendingOnly ? 'AND a.event_id IS NULL' : ''}
      ORDER BY e.sequence LIMIT ?`).all(channel, after, ...notificationTypes, limit);
    const entries = rows.map(parseNotification);
    if (!pendingOnly) {
      const recordCache = new Map(), acks = this.historyRows('archived_events', 'notificationAcks', recordCache);
      for (const row of this.historyRows('archived_events', 'events', recordCache).values()) if (row.event.channel === channel && row.sequence > after && acks.has(row.event.id))
        entries.push(OperatorNotification.parse({ id: row.event.id, channel, sequence: row.sequence, type: row.event.type, at: row.event.at,
          ...(row.event.entityID ? { entityID: row.event.entityID } : {}), acknowledgedAt: acks.get(row.event.id).acknowledgedAt }));
    }
    entries.sort((a, b) => a.sequence - b.sequence);
    return { entries: entries.slice(0, limit), next: entries.slice(0, limit).at(-1)?.sequence ?? after };
  }
  notification(channel, id) {
    this.available(); Channel.parse(channel); UUID.parse(id);
    const row = this.db.prepare(`SELECT e.*, a.acknowledged_at FROM events e LEFT JOIN notification_acks a ON a.event_id=e.id
      WHERE e.channel=? AND e.id=? AND ${notificationFilter}`).get(channel, id, ...notificationTypes);
    if (row) return parseNotification(row);
    const recordCache = new Map(), archived = this.historyRows('archived_events', 'events', recordCache).get(id), ack = this.historyRows('archived_events', 'notificationAcks', recordCache).get(id);
    check(archived?.event.channel === channel && ack, 'NOTIFICATION_NOT_FOUND');
    return OperatorNotification.parse({ id, channel, sequence: archived.sequence, type: archived.event.type, at: archived.event.at,
      ...(archived.event.entityID ? { entityID: archived.event.entityID } : {}), acknowledgedAt: ack.acknowledgedAt });
  }
  acknowledgeNotification(channel, id, now, expected) {
    Channel.parse(channel); UUID.parse(id); Stamp.parse(now);
    if (expected !== undefined) expected = ChannelPrecondition.parse(expected);
    return this.transaction(() => {
      const notice = this.notification(channel, id);
      if (notice.acknowledgedAt !== null) return notice; // Exact retry returns the original durable receipt even at capacity.
      const state = this.snapshot();
      if (expected !== undefined) {
        const current = state.channels.find(c => c.id === channel);
        check(current && JSON.stringify(channelPrecondition(current)) === JSON.stringify(expected), 'PRECONDITION_FAILED');
      }
      const last = Math.max(this.db.prepare('SELECT max(acknowledged_at) AS at FROM notification_acks').get().at ?? 0,
        ...[...this.historyRows('archived_events', 'notificationAcks').values()].map(row => row.acknowledgedAt));
      check(now >= Math.max(notice.at, state.lastNow, last), 'CLOCK_REGRESSION');
      check(this.db.prepare('SELECT count(*) AS total FROM notification_acks').get().total < this.notificationAckLimit, 'NOTIFICATION_ACKS_FULL');
      this.db.prepare('INSERT INTO notification_acks VALUES(?,?)').run(id, now);
      return this.notification(channel, id);
    });
  }
  commandReceipt(channel, commandID) {
    this.available(); Channel.parse(channel); UUID.parse(commandID);
    const row = this.findCommand(commandID);
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
    for (const event of events.filter(e => ['task.uncertain', 'task.completed', 'task.changes_requested'].includes(e.type))) {
      for (const row of this.db.prepare("SELECT * FROM notices WHERE channel=? AND status='pending'").all(event.channel)) {
        const notice = parseNotice(row);
        // Legacy task-review notices lack structured task identity. Refuse their
        // readiness hint rather than interpreting free-form text as authority.
        if (notice.kind !== 'task_review' || (notice.taskID !== undefined && notice.taskID !== event.entityID)) continue;
        const cancelled = Notice.parse({ ...notice, status: 'cancelled' });
        this.db.prepare('UPDATE notices SET status=?, body=? WHERE id=?').run('cancelled', JSON.stringify(cancelled), notice.id);
      }
    }
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
        generation: assignment.generation, promptVersion: assignment.promptVersion, kind, text, at: event.at, status: 'pending', ...(task ? { taskID: task.id } : {}) });
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
      const notice = row ? parseNotice(row) : this.historyRows('archived_notices', 'notices').get(noticeID)?.notice;
      check(notice && notice.channel === channel && notice.agentId === agentId, 'UNKNOWN_NOTICE');
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
      .all(channel, agentId, assignmentID).some(row => parseNotice(row).kind === 'offer') ||
      [...this.historyRows('archived_notices', 'notices').values()].some(({ notice }) => notice.channel === channel && notice.agentId === agentId &&
        notice.assignmentID === assignmentID && notice.status === 'accepted' && notice.kind === 'offer');
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
    this.verifyHistoryArchives();
    const state = this.snapshot(), quotas = [];
    const quota = (resource, used, limit) => quotas.push({ resource, used, limit, level: pressureLevel(used, limit) });
    for (const [resource, limit] of [['events', this.eventLimit], ['commands', this.commandLimit], ['notices', this.noticeLimit], ['credential_audit', 4096]])
      quota(resource, this.db.prepare(`SELECT count(*) AS total FROM ${resource}`).get().total, limit);
    quota('archived_commands', this.db.prepare('SELECT count(*) AS total FROM archived_commands').get().total, this.archivedCommandLimit);
    quota('archived_history_rows', ['archived_events', 'archived_notices', 'archived_task_payloads', 'archived_entities'].reduce((sum, table) => sum + this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0), this.archivedHistoryLimit);
    quota('hydrated_state_bytes', Buffer.byteLength(JSON.stringify(state)), this.hydratedStateByteLimit);
    quota('state_bytes', this.db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM control_state WHERE singleton=1').get().bytes, this.stateByteLimit);
    const pages = this.db.prepare('PRAGMA page_count').get().page_count;
    const freePages = this.db.prepare('PRAGMA freelist_count').get().freelist_count;
    quota('database_pages', pages - freePages, this.db.prepare('PRAGMA max_page_count').get().max_page_count);
    const hotState = JSON.parse(this.db.prepare('SELECT body FROM control_state').get().body);
    for (const [name, limit] of [['evidence', 16384], ['tasks', 4096], ['actions', 4096], ['incidents', 4096], ['previews', 4096], ['transitions', 4096], ['managedPreviews', 4096]])
      quota(name, hotState[name].length, limit);
    for (const kind of HISTORY_KINDS) quota(`cold_${kind}`, this.db.prepare('SELECT count(*) AS n FROM archived_entities WHERE kind=?').get(kind).n, entityLimit(kind));
    quota('cold_credential_audit', this.db.prepare("SELECT count(*) AS n FROM archived_entities WHERE kind='credential_audit'").get().n, 4096);
    quota('adapter_health', this.db.prepare('SELECT count(*) AS total FROM adapter_health').get().total, 4096);
    quota('notification_acks', this.db.prepare('SELECT count(*) AS total FROM notification_acks').get().total, this.notificationAckLimit);
    quota('checkpoint_observations', this.db.prepare('SELECT count(*) AS total FROM checkpoint_observations').get().total, 4096);
    quota('checkpoint_destinations', this.db.prepare('SELECT count(*) AS total FROM checkpoint_destinations').get().total, 4096);
    const disk = this.diskStats(this.directory), availableBytes = disk.bavail * disk.bsize, totalBytes = disk.blocks * disk.bsize;
    check(Number.isSafeInteger(availableBytes) && Number.isSafeInteger(totalBytes) && availableBytes >= 0 && totalBytes > 0 && availableBytes <= totalBytes, 'CONTROL_STORAGE_UNAVAILABLE');
    quotas.push({ resource: 'disk', used: totalBytes - availableBytes, limit: totalBytes,
      level: availableBytes < Math.max(16 * 1024 * 1024, totalBytes * 0.02) ? 'critical' : availableBytes < Math.max(64 * 1024 * 1024, totalBytes * 0.05) ? 'warning' : 'ok' });
    return { quotas, disk: { availableBytes, totalBytes }, unresolved: {
      tasks: state.tasks.filter(t => t.terminalHold || !['completed', 'cancelled'].includes(t.status)).length,
      actions: state.actions.filter(a => !['succeeded', 'failed', 'rejected'].includes(a.status)).length,
      incidents: state.incidents.filter(i => i.status === 'open').length,
      transitions: state.transitions.filter(t => transitionHoldsConversation(t)).length,
      managedPreviews: state.managedPreviews.filter(p => ['executing', 'uncertain'].includes(p.status)).length,
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
        for (const record of store.historyRows('archived_events', 'events').values()) yield { kind: 'event', value: record };
        for (const row of store.db.prepare('SELECT id, fingerprint, result FROM commands ORDER BY rowid').iterate())
          yield { kind: 'command', value: { id: row.id, fingerprint: row.fingerprint, result: JSON.parse(row.result) } };
        for (const archive of store.db.prepare('SELECT id, digest FROM receipt_archives ORDER BY rowid').all()) {
          const commands = store.receiptArchives.commands(archive.id, archive.digest);
          for (const row of store.db.prepare('SELECT id FROM archived_commands WHERE archive_id=? ORDER BY rowid').all(archive.id)) {
            const receipt = commands.get(row.id); check(!!receipt, 'CONTROL_ARCHIVE_RECEIPT_MISSING');
            yield { kind: 'command', value: receipt };
          }
        }
        for (const row of store.db.prepare('SELECT * FROM notices ORDER BY sequence').iterate())
          yield { kind: 'notice', value: { sequence: row.sequence, notice: parseNotice(row) } };
        for (const record of store.historyRows('archived_notices', 'notices').values()) yield { kind: 'notice', value: record };
        for (const row of store.db.prepare('SELECT body FROM effect_intents ORDER BY rowid').iterate())
          yield { kind: 'effect_intent', value: Action.parse(JSON.parse(row.body)) };
        // Credential audit is exportable; authentication digests/registries are deliberately not selected.
        for (const row of store.db.prepare('SELECT sequence, host_id, action, at FROM credential_audit ORDER BY sequence').iterate())
          yield { kind: 'credential_audit', value: { sequence: row.sequence, hostId: row.host_id, action: row.action, at: row.at } };
        for (const row of store.historyRows('archived_entities', 'credentialAudit').values()) yield { kind: 'credential_audit', value: row };
        for (const row of store.db.prepare('SELECT * FROM activity ORDER BY sequence').iterate())
          yield { kind: 'activity', value: { sequence: row.sequence, activity: parseActivity(row) } };
        yield { kind: 'activity_status', value: store.activityStatus() };
        for (const row of store.db.prepare('SELECT * FROM adapter_health ORDER BY agent_id').iterate())
          yield { kind: 'adapter_health', value: parseHealth(row) };
        for (const row of store.db.prepare('SELECT * FROM notification_acks ORDER BY event_id').iterate())
          yield { kind: 'notification_ack', value: { id: UUID.parse(row.event_id), acknowledgedAt: Stamp.parse(row.acknowledged_at) } };
        for (const record of store.historyRows('archived_events', 'notificationAcks').values()) yield { kind: 'notification_ack', value: record };
        for (const row of store.db.prepare('SELECT request_id FROM checkpoint_observations ORDER BY rowid').iterate())
          yield { kind: 'checkpoint_observation', value: store.checkpointObservation(row.request_id) };
        for (const row of store.db.prepare('SELECT request_id FROM checkpoint_destinations ORDER BY rowid').iterate())
          yield { kind: 'checkpoint_destination', value: store.checkpointDestination(row.request_id) };
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
  adapterRevocationObserved(hostId) {
    this.available(); HostID.parse(hostId);
    const credential = this.db.prepare('SELECT 1 FROM adapter_credentials WHERE host_id=?').get(hostId);
    const audit = this.db.prepare('SELECT action FROM credential_audit WHERE host_id=? ORDER BY sequence DESC LIMIT 1').get(hostId);
    return !credential && audit?.action === 'revoked';
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { try { this.db.close(); } finally { this.unlock(); } }
  }
}
