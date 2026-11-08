#!/usr/bin/env node
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory, readPrivate, atomicWrite, acquireStore, assertPrivateFile } from './storage.js';
import { ChannelClient } from './client.js';
import { validateCredential } from './config.js';
import { Channel } from './protocol.js';
import { OperatorNotification } from './control/notification-contracts.js';
import { StorageStatus } from './control/storage-contracts.js';
import { requireControl as check } from './control/policy.js';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().max(4096).refine(isAbsolute);
export const AttentionConfig = z.strictObject({ version: z.literal(1), url: z.string().max(2048), tokenFile: absolute,
  channel: Channel, directory: absolute, nativeExecutable: absolute.optional(), intervalMs: z.number().int().min(1000).max(60000).default(15000),
  nativeTimeoutMs: z.number().int().min(100).max(30000).default(10000), maxRecords: z.number().int().min(1).max(8192).default(8192) });
const Delivery = z.strictObject({ key: digest, fingerprint: digest, kind: z.enum(['notification', 'storage', 'health', 'connectivity']),
  state: z.enum(['intent', 'submitted', 'not_submitted', 'uncertain']), at: stamp });
const Journal = z.strictObject({ version: z.literal(1), binding: digest, next: stamp,
  conditions: z.strictObject({ storage: digest.nullable(), health: digest.nullable(), connectivity: digest.nullable().default(null) }), deliveries: z.array(Delivery).max(8192) });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_JOURNAL_BYTES = 3 * 1024 * 1024;
const bindingFor = config => hash({ url: config.url, channel: config.channel, tokenFile: config.tokenFile });
const summarize = (state, limit) => ({ version: 1, records: state.deliveries.length, limit,
  submitted: state.deliveries.filter(r => r.state === 'submitted').length,
  notSubmitted: state.deliveries.filter(r => r.state === 'not_submitted').length,
  uncertain: state.deliveries.filter(r => ['intent', 'uncertain'].includes(r.state)).length, humanAcknowledged: false });
export function readAttentionStatus(input) {
  const config = AttentionConfig.parse(input), file = join(config.directory, 'attention.json');
  // Verify the existing private directory without making a status read create
  // or initialize a journal. Atomic snapshots require no writer lock.
  const directory = lstatSync(config.directory);
  check(directory.isDirectory() && !directory.isSymbolicLink() && (process.platform === 'win32' ||
    (!(directory.mode & 0o077) && directory.uid === process.getuid())), 'ATTENTION_JOURNAL_INSECURE');
  if (process.platform === 'win32') privateDirectory(config.directory);
  check(assertPrivateFile(file).nlink === 1, 'ATTENTION_JOURNAL_INSECURE');
  const state = Journal.parse(JSON.parse(readPrivate(file, MAX_JOURNAL_BYTES)));
  check(state.binding === bindingFor(config), 'ATTENTION_JOURNAL_BINDING');
  check(new Set(state.deliveries.map(row => row.key)).size === state.deliveries.length, 'ATTENTION_JOURNAL_INVALID');
  return summarize(state, config.maxRecords);
}

export class AttentionJournal {
  constructor(config) {
    this.config = AttentionConfig.parse(config); privateDirectory(config.directory); this.closed = false;
    this.unlock = acquireStore(config.directory, () => { this.fault = true; });
    this.file = join(config.directory, 'attention.json');
    try {
      const binding = bindingFor(config);
      try { check(assertPrivateFile(this.file).nlink === 1, 'ATTENTION_JOURNAL_INSECURE'); this.state = Journal.parse(JSON.parse(readPrivate(this.file, MAX_JOURNAL_BYTES))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; this.state = { version: 1, binding, next: 0, conditions: { storage: null, health: null, connectivity: null }, deliveries: [] }; }
      check(this.state.binding === binding, 'ATTENTION_JOURNAL_BINDING');
      check(new Set(this.state.deliveries.map(r => r.key)).size === this.state.deliveries.length, 'ATTENTION_JOURNAL_INVALID');
      for (const row of this.state.deliveries) if (row.state === 'intent') row.state = 'uncertain';
      this.save();
    } catch (error) { this.unlock(); throw error; }
  }
  save() {
    check(!this.fault && !this.closed, 'ATTENTION_JOURNAL_UNAVAILABLE');
    const body = JSON.stringify(Journal.parse(this.state)); check(Buffer.byteLength(body) <= MAX_JOURNAL_BYTES, 'ATTENTION_JOURNAL_FULL');
    try { atomicWrite(this.file, body); } catch (error) { this.fault = true; throw error; }
  }
  async submit(kind, key, fingerprint, emit) {
    const prior = this.state.deliveries.find(r => r.key === key);
    if (prior) { check(prior.fingerprint === fingerprint, 'ATTENTION_NOTIFICATION_CHANGED'); return prior.state; }
    check(this.state.deliveries.length < this.config.maxRecords, 'ATTENTION_JOURNAL_FULL');
    const row = Delivery.parse({ kind, key, fingerprint, state: 'intent', at: Date.now() });
    this.state.deliveries.push(row); this.save();
    let outcome;
    try { outcome = await emit(); } catch { outcome = 'uncertain'; }
    check(['submitted', 'not_submitted', 'uncertain'].includes(outcome), 'ATTENTION_SUBMISSION_INVALID');
    row.state = outcome; this.save(); return outcome;
  }
  async condition(kind, value, emit) {
    const fingerprint = value === null ? null : hash(value);
    if (fingerprint === this.state.conditions[kind]) return;
    if (fingerprint !== null) {
      check(this.state.next < Number.MAX_SAFE_INTEGER, 'ATTENTION_JOURNAL_FULL');
      // Reserve the episode before native submission. If submission fails or the
      // daemon crashes, this durable episode is never submitted a second time.
      this.state.next++;
      const key = hash({ kind, episode: this.state.next });
      this.state.conditions[kind] = fingerprint;
      await this.submit(kind, key, fingerprint, emit);
    } else { this.state.conditions[kind] = null; this.save(); }
  }
  status() { return summarize(this.state, this.config.maxRecords); }
  close() { if (!this.closed) { this.closed = true; this.unlock(); } }
}

export function nativeAttentionCommand(platform = process.platform) {
  if (platform === 'darwin') return { file: '/usr/bin/osascript', args: ['-e', 'display notification "Inspect the private Turnlink operator inbox." with title "Turnlink needs attention"'] };
  if (platform === 'linux') return { file: '/usr/bin/notify-send', args: ['--app-name=Turnlink', '--', 'Turnlink needs attention', 'Inspect the private Turnlink operator inbox.'] };
  if (platform === 'win32') return { file: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; $xml=New-Object Windows.Data.Xml.Dom.XmlDocument; $xml.LoadXml(\'<toast><visual><binding template="ToastGeneric"><text>Turnlink needs attention</text><text>Inspect the private Turnlink operator inbox.</text></binding></visual></toast>\'); $toast=[Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Turnlink").Show($toast)'] };
  throw new Error('ATTENTION_PLATFORM_UNSUPPORTED');
}
export function submitNativeAttention(config, signal) {
  signal?.throwIfAborted();
  const command = nativeAttentionCommand();
  return new Promise(resolveResult => {
    let child, started = false, settled = false;
    const settle = value => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolveResult(value); };
    const abort = () => { child?.kill('SIGKILL'); settle(child ? 'uncertain' : 'not_submitted'); };
    const timer = setTimeout(abort, config.nativeTimeoutMs);
    try {
      child = spawn(config.nativeExecutable || command.file, command.args, { stdio: 'ignore', windowsHide: true, shell: false });
      child.once('spawn', () => { started = true; });
      child.once('error', () => settle(started ? 'uncertain' : 'not_submitted'));
      child.once('exit', (code, childSignal) => settle(code === 0 && !childSignal ? 'submitted' : 'uncertain'));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    } catch { settle('not_submitted'); }
  });
}

const InboxPage = z.strictObject({ entries: z.array(OperatorNotification).max(100), next: stamp });
const HealthPage = z.object({ entries: z.array(z.object({ agentId: z.string().max(256), channel: Channel,
  status: z.enum(['disconnected', 'unreported', 'stale', 'unknown', 'attention', 'observed']) })).max(100), next: stamp.optional() });
export async function pollOperatorAttention({ config, client, journal, signal }) {
  signal?.throwIfAborted(); await client.connect(); check(client.admin === true, 'OPERATOR_REQUIRED');
  const emit = () => submitNativeAttention(config, signal);
  let cursor = journal.inboxCursor || 0;
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    const page = InboxPage.parse(await client.request('control_notifications', { channel: config.channel, after: cursor, limit: 100, pendingOnly: true }));
    for (const notice of page.entries) {
      check(notice.channel === config.channel && notice.acknowledgedAt === null && notice.sequence > cursor, 'ATTENTION_INBOX_INVALID');
      cursor = notice.sequence; signal?.throwIfAborted();
      await journal.submit('notification', hash({ notification: notice.id }), hash(notice), emit);
    }
    check(page.next === cursor, 'ATTENTION_INBOX_INVALID');
    journal.inboxCursor = page.entries.length < 100 ? 0 : cursor;
    if (page.entries.length < 100) break;
  }
  signal?.throwIfAborted();
  const storage = StorageStatus.parse(await client.request('control_storage_status'));
  await journal.condition('storage', storage.pressure.level === 'ok' ? null : storage.pressure, emit);
  journal.healthScan ??= []; journal.healthCursor ??= 0;
  for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
    const health = HealthPage.parse(await client.request('control_query', { channel: config.channel, view: 'health', offset: journal.healthCursor, limit: 100 }));
    check(health.next === journal.healthCursor + health.entries.length, 'ATTENTION_HEALTH_INVALID');
    journal.healthCursor = health.next;
    for (const row of health.entries) {
      check(row.channel === config.channel, 'ATTENTION_HEALTH_INVALID');
      if (row.status !== 'observed') journal.healthScan.push({ agentId: row.agentId, status: row.status });
    }
    check(journal.healthCursor <= 8192, 'ATTENTION_HEALTH_LIMIT');
    if (health.entries.length < 100) {
      const attention = [...new Map(journal.healthScan.map(row => [row.agentId, row])).values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
      await journal.condition('health', attention.length ? attention : null, emit);
      journal.healthScan = []; journal.healthCursor = 0; break;
    }
  }
}

export async function runOperatorAttention({ config, client, signal, journal, onStatus = () => {} }) {
  while (!signal.aborted) {
    try {
      await pollOperatorAttention({ config, client, journal, signal }); signal.throwIfAborted();
      // Only an authenticated successful broker poll closes an outage episode.
      await journal.condition('connectivity', null, () => submitNativeAttention(config, signal));
      onStatus({ event: 'polled', ...journal.status() });
    }
    catch (error) {
      if (signal.aborted) break;
      const refused = error.code === 'OPERATOR_REQUIRED' || error.message === 'OPERATOR_REQUIRED' ||
        /^Unexpected server response: (401|403)$/.test(error.message || '');
      if (journal.fault || (!refused && /^ATTENTION_/.test(error.code || error.message))) throw error;
      await journal.condition('connectivity', 'broker_unavailable', () => submitNativeAttention(config, signal));
      if (refused) {
        onStatus({ event: 'admission_refused', ...journal.status() });
        check(false, 'ATTENTION_ADMISSION_REFUSED');
      }
      onStatus({ event: 'disconnected', ...journal.status() });
    }
    try { await delay(config.intervalMs, undefined, { signal }); } catch (error) { if (!signal.aborted) throw error; }
  }
}

async function main() {
  const [operation, file, ...extra] = process.argv.slice(2);
  check(['run', 'status'].includes(operation) && !!file && isAbsolute(file) && !extra.length, 'ATTENTION_USAGE');
  const config = AttentionConfig.parse(JSON.parse(readPrivate(file, 16384)));
  if (operation === 'status') { console.log(JSON.stringify(readAttentionStatus(config))); return; }
  if (config.nativeExecutable) check(assertPrivateFile(config.nativeExecutable).nlink === 1, 'ATTENTION_EXECUTABLE_INSECURE');
  const journal = new AttentionJournal(config); let client;
  const controller = new AbortController(), stop = () => { controller.abort(); client?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    client = new ChannelClient({ url: config.url, token: validateCredential(readPrivate(config.tokenFile, 128).trim()) });
    await runOperatorAttention({ config, client, signal: controller.signal, journal, onStatus: value => console.log(JSON.stringify(value)) });
  } finally { client?.close(); journal.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Turnlink operator attention stopped; inspect the private journal and configuration.'); process.exitCode = 1; });
