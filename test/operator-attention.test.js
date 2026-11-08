import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { AttentionConfig, AttentionJournal, submitNativeAttention, pollOperatorAttention } from '../src/operator-attention.js';

async function waitFor(fn, timeoutMs = 4000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (fn()) return; await delay(20); } assert.fail('condition timed out'); }
function nativeFixture(root, { delayMs = 0, exitCode = 0, hold = false } = {}) {
  const native = join(root, process.platform === 'win32' ? 'native.exe' : 'native');
  if (process.platform !== 'win32') {
    writeFileSync(native, `#!${process.execPath}\nimport {appendFileSync,existsSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(root, 'calls'))}, JSON.stringify(process.argv.slice(2))+'\\n'); ${hold ? `const deadline=Date.now()+20000;const gate=setInterval(()=>{if(Date.now()>deadline)process.exit(9);if(existsSync(${JSON.stringify(join(root, 'release-native'))})){clearInterval(gate);process.exit(${exitCode});}},20);` : `setTimeout(()=>process.exit(${exitCode}),${delayMs});`}`, { mode: 0o700 });
    return native;
  }
  // Compile a private test executable instead of treating a POSIX shebang as a Windows program.
  const source = join(root, 'native.cs');
  writeFileSync(source, `using System; using System.IO; using System.Threading; using System.Web.Script.Serialization;
public static class NativeFixture { public static int Main(string[] args) {
  File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "calls"), new JavaScriptSerializer().Serialize(args) + Environment.NewLine);
  ${hold ? 'var deadline = DateTime.UtcNow.AddSeconds(20); while (!File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "release-native"))) { if (DateTime.UtcNow > deadline) return 9; Thread.Sleep(20); }' : ''}
  Thread.Sleep(${delayMs}); return ${exitCode};
} }`);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `$ErrorActionPreference='Stop'; Add-Type -Path ${quote(source)} -ReferencedAssemblies 'System.Web.Extensions' -OutputAssembly ${quote(native)} -OutputType ConsoleApplication`;
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const compiled = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stderr); return native;
}
async function fixture(t, nativeOptions = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-attention-'));
  const create = (port = 0) => createBroker({ directory: join(root, 'broker'), port, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, sweepIntervalMs: 10000,
    controlOptions: { diskStats: () => ({ bsize: 4096, blocks: 262144000, bavail: 131072000 }) } });
  let broker = create();
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, admin = new ChannelClient({ url, token: '2'.repeat(64) });
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'channel.configure' } });
  const result = await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' } });
  const id = result.eventIDs[0];
  const calls = join(root, 'calls'), native = nativeFixture(root, nativeOptions);
  const tokenFile = join(root, 'token'); writeFileSync(tokenFile, '2'.repeat(64), { mode: 0o600 });
  const directory = join(root, 'journal'), config = join(root, 'config.json');
  const nativeTimeoutMs = nativeOptions.hold ? 30000 : process.platform === 'win32' ? 10000 : 1000;
  writeFileSync(config, JSON.stringify({ version: 1, url, tokenFile, channel: 'dev', directory, nativeExecutable: native, intervalMs: 1000, nativeTimeoutMs }), { mode: 0o600 });
  const children = new Set(), outputs = new WeakMap();
  const track = child => {
    children.add(child); outputs.set(child, { stdout: '', stderr: '', closed: false });
    child.stdout?.on('data', bytes => { const value = outputs.get(child); value.stdout = (value.stdout + bytes).slice(-8192); });
    child.stderr?.on('data', bytes => { const value = outputs.get(child); value.stderr = (value.stderr + bytes).slice(-8192); });
    child.on('exit', () => children.delete(child)); child.on('close', () => { outputs.get(child).closed = true; }); return child;
  };
  const start = () => track(spawn(process.execPath, ['src/operator-attention.js', 'run', config], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const journal = () => JSON.parse(readFileSync(join(directory, 'attention.json'), 'utf8'));
  const ready = async (child, phase, check) => {
    // Windows startup verifies four private paths through bounded 10s ACL helpers.
    // Broker RPCs have a 5s deadline, and an outage poll may emit two native episodes.
    const budget = phase === 'startup' ? (process.platform === 'win32' ? 4 * 10000 : 0) + 2 * 5000 + nativeTimeoutMs :
      phase === 'native' ? nativeTimeoutMs + 5000 : 2 * 5000 + 2 * nativeTimeoutMs + 1000;
    try { await waitFor(() => {
      let value = false;
      try { value = check(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!value && outputs.get(child).closed) throw new Error('daemon exited before readiness');
      return value;
    }, budget); }
    catch { assert.fail(JSON.stringify({ phase, budget, exitCode: child.exitCode, signalCode: child.signalCode,
      output: outputs.get(child), journal: existsSync(join(directory, 'attention.json')) ? journal() : 'not_created' })); }
  };
  const reported = (child, event) => outputs.get(child).stdout.includes(`"event":"${event}"`);
  const polled = child => reported(child, 'polled');
  const closed = child => outputs.get(child).closed;
  const stop = async child => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    // Windows termination does not deliver POSIX SIGTERM handlers. Age only the dead fixture writer's lease.
    if (process.platform === 'win32' && existsSync(`${directory}.lock`)) utimesSync(`${directory}.lock`, new Date(Date.now() - 61000), new Date(Date.now() - 61000));
  };
  t.after(async () => {
    if (nativeOptions.hold) writeFileSync(join(root, 'release-native'), 'release fixture during cleanup', { mode: 0o600 });
    for (const c of children) if (c.exitCode === null && c.signalCode === null) { const exited = once(c, 'exit'); c.kill('SIGKILL'); await exited; }
    admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return { root, get broker() { return broker; }, admin, start, stop, ready, polled, reported, closed, track, journal, calls, config, directory, id,
    async restartBroker() { broker = create(Number(new URL(url).port)); await once(broker.server, 'listening'); } };
}
test('standalone daemon submits fixed native content once across process restart without acknowledging broker inbox', async t => {
  const f = await fixture(t), child = f.start();
  await f.ready(child, 'startup', () => existsSync(f.calls));
  await f.ready(child, 'native', () => f.journal().deliveries.some(r => r.state === 'submitted'));
  await f.stop(child);
  const count = readFileSync(f.calls, 'utf8').trim().split('\n').length;
  const next = f.start(); await f.ready(next, 'startup', () => f.polled(next)); await f.stop(next);
  assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, count);
  const inbox = await f.admin.request('control_notifications', { channel: 'dev', pendingOnly: true });
  assert.ok(inbox.entries.some(n => n.id === f.id && n.acknowledgedAt === null));
  assert.ok(!readFileSync(f.calls, 'utf8').includes(f.id));
});
test('native invocation interrupted by process death stays quarantined after restart', async t => {
  const f = await fixture(t, { hold: true }), child = f.start();
  await f.ready(child, 'startup', () => existsSync(f.calls)); child.kill('SIGKILL'); await once(child, 'exit');
  writeFileSync(join(f.root, 'release-native'), 'release dead-owner fixture', { mode: 0o600 });
  // Actual process death leaves the standard exclusive-store lock. Advance only
  // this dead fixture's lock age rather than waiting its production 60s lease.
  utimesSync(`${f.directory}.lock`, new Date(Date.now() - 61000), new Date(Date.now() - 61000));
  const next = f.start(); await f.ready(next, 'startup', () => f.journal().deliveries.some(r => r.state === 'uncertain') && f.polled(next)); await f.stop(next);
  assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, 1, JSON.stringify(f.journal()));
});
test('abort immediately after spawning records an uncertain outcome rather than proof of non-submission', async t => {
  const f = await fixture(t, { delayMs: 500 });
  const config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8'))), controller = new AbortController();
  const pending = submitNativeAttention(config, controller.signal); controller.abort();
  assert.equal(await pending, 'uncertain');
});
test('bounded journal retains submission uncertainty and never repeats an uncertain key', async t => {
  const f = await fixture(t), config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8')));
  config.maxRecords = 1; const journal = new AttentionJournal(config); t.after(() => journal.close());
  const key = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  assert.equal(await journal.submit('notification', key, fingerprint, () => { throw new Error('lost native receipt'); }), 'uncertain');
  assert.equal(await journal.submit('notification', key, fingerprint, () => assert.fail('must not repeat')), 'uncertain');
  await assert.rejects(journal.submit('notification', 'c'.repeat(64), fingerprint, () => assert.fail('capacity must refuse before spawn')), /ATTENTION_JOURNAL_FULL/);
  assert.equal(journal.status().uncertain, 1); assert.equal(journal.status().humanAcknowledged, false);
});
test('bounded notification polling eventually passes four full pages of already submitted pending IDs', async t => {
  const f = await fixture(t), config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8')));
  const journal = new AttentionJournal(config); t.after(() => journal.close());
  const notices = Array.from({ length: 401 }, (_, index) => ({ id: randomUUID(), channel: 'dev', sequence: index + 1,
    type: 'incident.opened', at: 1, acknowledgedAt: null }));
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const notice of notices.slice(0, 400)) await journal.submit('notification', hash({ notification: notice.id }), hash(notice), async () => 'submitted');
  const client = { admin: true, connect: async () => {}, request: async (method, params) => {
    if (method !== 'control_notifications') return f.admin.request(method, params);
    const entries = notices.filter(n => n.sequence > params.after).slice(0, params.limit);
    return { entries, next: entries.at(-1)?.sequence ?? params.after };
  } };
  await pollOperatorAttention({ config, client, journal }); await pollOperatorAttention({ config, client, journal });
  assert.equal(journal.status().records, 401);
});
test('health attention beyond the first page is included after a bounded complete scan', async t => {
  const f = await fixture(t), config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8')));
  const journal = new AttentionJournal(config); t.after(() => journal.close());
  const health = Array.from({ length: 201 }, (_, index) => ({ agentId: `opencode:agent-${index}`, channel: 'dev', status: index === 200 ? 'attention' : 'observed' }));
  const client = { admin: true, connect: async () => {}, request: async (method, params) => {
    if (method === 'control_notifications') return { entries: [], next: params.after };
    if (method === 'control_query') { const entries = health.slice(params.offset, params.offset + params.limit); return { entries, next: params.offset + entries.length }; }
    return f.admin.request(method, params);
  } };
  await pollOperatorAttention({ config, client, journal }); await pollOperatorAttention({ config, client, journal });
  assert.equal(journal.state.deliveries.filter(row => row.kind === 'health' && row.state === 'submitted').length, 1);
});
test('daemon reconnects after a broker socket disconnect without resubmitting delivered notifications', async t => {
  const f = await fixture(t), child = f.start(); let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  await f.ready(child, 'startup', () => existsSync(f.calls)); await f.ready(child, 'startup', () => f.polled(child));
  const disconnected = once(f.admin, 'disconnected');
  for (const socket of f.broker.server.clients) socket.terminate();
  await disconnected;
  const result = await f.admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'connectivity' } });
  await f.ready(child, 'poll', () => f.journal().deliveries.filter(row => row.kind === 'notification' && row.state === 'submitted').length === 2);
  assert.ok(result.eventIDs.length); assert.equal(child.exitCode, null);
  await f.stop(child);
  assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, f.journal().deliveries.filter(row => row.state === 'submitted').length);
});
test('status inspects a running daemon without acquiring its writer lock or changing the journal', async t => {
  const f = await fixture(t, { hold: true }), child = f.start(); await f.ready(child, 'startup', () => existsSync(f.calls));
  const file = join(f.directory, 'attention.json'), before = readFileSync(file);
  const status = f.track(spawn(process.execPath, ['src/operator-attention.js', 'status', f.config], { stdio: ['ignore', 'pipe', 'pipe'] }));
  let output = ''; status.stdout.on('data', bytes => { output += bytes; });
  await f.ready(status, 'startup', () => f.closed(status)); assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(output).humanAcknowledged, false); assert.equal(JSON.parse(output).uncertain, 1);
  assert.deepEqual(readFileSync(file), before);
  writeFileSync(join(f.root, 'release-native'), 'release after status inspection', { mode: 0o600 });
  await f.ready(child, 'native', () => f.journal().deliveries.some(row => row.state !== 'intent'));
  assert.equal(f.journal().deliveries[0].state, 'submitted', JSON.stringify({ journal: f.journal(), exitCode: child.exitCode }));
  await f.stop(child);
});
test('native start refusal and started nonzero exit remain different submission classifications', async t => {
  const f = await fixture(t, { exitCode: 7 }), config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8')));
  assert.equal(await submitNativeAttention({ ...config, nativeExecutable: join(f.root, 'missing') }), 'not_submitted');
  assert.equal(await submitNativeAttention(config), 'uncertain');
});
test('broker outage submits one durable native episode across daemon restart and recovery allows a new outage', async t => {
  const f = await fixture(t), child = f.start(); let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  await f.ready(child, 'startup', () => f.polled(child));
  await f.broker.close();
  await f.ready(child, 'poll', () => f.journal().deliveries.some(row => row.kind === 'connectivity' && row.state === 'submitted') && (output.match(/"event":"disconnected"/g) || []).length >= 2); await f.stop(child);
  const next = f.start(); await f.ready(next, 'startup', () => f.reported(next, 'disconnected'));
  assert.equal(f.journal().deliveries.filter(row => row.kind === 'connectivity').length, 1);
  await f.restartBroker();
  await f.ready(next, 'poll', () => f.journal().conditions.connectivity === null);
  await f.broker.close();
  await f.ready(next, 'poll', () => f.journal().deliveries.filter(row => row.kind === 'connectivity' && row.state === 'submitted').length === 2);
  await f.stop(next);
  assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, 3);
});
test('broker authentication refusal raises fixed native attention and stops visibly instead of retrying indefinitely', async t => {
  const f = await fixture(t), config = JSON.parse(readFileSync(f.config, 'utf8'));
  writeFileSync(config.tokenFile, '3'.repeat(64));
  const child = f.start(); let output = ''; child.stdout.on('data', bytes => { output += bytes; });
  await f.ready(child, 'startup', () => f.closed(child)); assert.equal(child.exitCode, 1);
  assert.ok(output.includes('"event":"admission_refused"'));
  assert.equal(f.journal().deliveries.filter(row => row.kind === 'connectivity' && row.state === 'submitted').length, 1);
  assert.ok(!output.includes('3'.repeat(64)));
});
test('legacy journal gains a connectivity condition without resubmitting old or uncertain intents', async t => {
  const f = await fixture(t), config = AttentionConfig.parse(JSON.parse(readFileSync(f.config, 'utf8')));
  const journal = new AttentionJournal(config), key = 'd'.repeat(64), fingerprint = 'e'.repeat(64);
  await journal.submit('notification', key, fingerprint, async () => 'submitted'); journal.close();
  const file = join(f.directory, 'attention.json'), old = JSON.parse(readFileSync(file, 'utf8'));
  delete old.conditions.connectivity;
  old.deliveries.push({ key: 'f'.repeat(64), fingerprint, kind: 'notification', state: 'intent', at: Date.now() });
  writeFileSync(file, JSON.stringify(old));
  const reopened = new AttentionJournal(config); t.after(() => reopened.close());
  assert.equal(reopened.state.conditions.connectivity, null);
  assert.equal(await reopened.submit('notification', key, fingerprint, () => assert.fail('legacy receipt must not repeat')), 'submitted');
  assert.equal(await reopened.submit('notification', 'f'.repeat(64), fingerprint, () => assert.fail('legacy intent must not repeat')), 'uncertain');
  assert.equal(reopened.status().records, 2);
});
