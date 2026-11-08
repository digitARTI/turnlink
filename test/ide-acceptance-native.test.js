import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startIDEFixture, cleanupIDEFixture } from '../deploy/ide-acceptance-fixture.js';

test('manual fixture generated configuration completes real Codex MCP role and existing-cwd task flow without editor or remote inference', {
  skip: process.env.TURNLINK_CODEX_MANUAL_FIXTURE_INTEGRATION !== '1', timeout: 90000,
}, async t => {
  const native = process.env.TURNLINK_CODEX_EXECUTABLE;
  assert.ok(native, 'Explicit absolute installed native executable required');
  const proxy = resolve('src/codex-proxy.js'), fixture = await startIDEFixture({ native, proxy });
  let child, closed, version = 'unobserved', sequence = 0, diagnostic = '', threadID, stage = 'version';
  const pending = new Map(), completed = new Map();
  const reject = error => { for (const value of pending.values()) { clearTimeout(value.timer); value.reject(error); } pending.clear(); };
  // Own cleanup immediately: config reads, version probing and process launch
  // can all fail before initialization has registered any native RPC state.
  t.after(async () => {
    reject(new Error('Owned fixture stopped'));
    if (child) { if (child.pid && child.exitCode === null && child.signalCode === null) child.kill(); await closed; }
    await fixture.close();
    t.diagnostic(JSON.stringify({ root: fixture.root, version, stage, diagnostic: diagnostic.replace(/[a-f0-9]{64}/g, '[fixture-digest]') }));
    if (process.env.TURNLINK_KEEP_MANUAL_FIXTURE !== '1') cleanupIDEFixture(fixture.root);
  });
  const environment = { PATH: process.env.PATH, ...JSON.parse(readFileSync(join(fixture.root, 'environment.json'), 'utf8')) };
  const versionTimeout = Number(process.env.TURNLINK_CODEX_VERSION_TIMEOUT_MS || 10000);
  assert.ok(Number.isInteger(versionTimeout) && versionTimeout >= 100 && versionTimeout <= 30000, 'Bounded native version deadline required');
  version = execFileSync(native, ['--version'], { env: environment, encoding: 'utf8', timeout: versionTimeout }).trim();
  stage = 'initialize';
  child = spawn(process.execPath, [proxy, 'app-server'], { cwd: join(fixture.root, 'project'), env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  closed = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
  child.once('error', reject); child.once('exit', () => reject(new Error('Owned fixture proxy exited')));
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'turn/completed') completed.set(message.params.turn.id, message.params.turn.status);
    if (message.id !== undefined && message.method === 'mcpServer/elicitation/request') {
      // Explicit consent by this isolated test operator applies only to the
      // generated known local fixture server, never a real session approval.
      assert.equal(message.params.serverName, 'turnlink');
      assert.deepEqual(message.params.requestedSchema, { type: 'object', properties: {} });
      child.stdin.write(JSON.stringify({ id: message.id, result: { action: 'accept', content: {} } }) + '\n');
    }
    const value = pending.get(message.id); if (!value || message.method) return;
    clearTimeout(value.timer); pending.delete(message.id);
    if (message.error) value.reject(new Error(`Native fixture RPC ${value.method} refused (${message.error.code}): ${String(message.error.message).slice(0, 300)}`));
    else value.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native fixture RPC ${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer, method }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const wait = async (predicate, reason, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await predicate()) return; await delay(300); }
    throw new Error(`Native manual fixture ${reason} timeout; diagnostic=${diagnostic}`);
  };
  const turn = async text => {
    const result = await rpc('turn/start', { threadId: threadID, input: [{ type: 'text', text }] });
    await wait(() => completed.has(result.turn.id), 'turn completion');
    assert.equal(completed.get(result.turn.id), 'completed');
  };
  await rpc('initialize', { clientInfo: { name: 'turnlink_manual_fixture_acceptance', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const initial = await rpc('thread/start', { cwd: realpathSync(join(fixture.root, 'project')) }); threadID = initial.thread.id;
  stage = 'baseline';
  await turn('TURNLINK_MANUAL_BASELINE');
  const baseline = await fixture.status(); assert.equal(baseline.modelRequests, 1);
  assert.deepEqual(baseline.instructions, { global: true, project: true });
  stage = 'join'; await turn('TURNLINK_MANUAL_JOIN'); stage = 'volunteer'; await turn('TURNLINK_MANUAL_VOLUNTEER');
  stage = 'appoint';
  const offer = await fixture.phase('appoint');
  await wait(async () => (await fixture.status()).acceptedNoticeIDs.length > 0, 'role admission', 45000);
  await wait(async () => (await rpc('thread/read', { threadId: threadID, includeTurns: true })).thread.turns.every(value => ['completed', 'failed', 'interrupted'].includes(value.status)), 'role turn stop');
  await turn(offer.prompt);
  stage = 'task';
  await wait(async () => (await fixture.status()).channel.activeID === offer.assignmentID, 'role acceptance');
  const task = await fixture.phase('task'); await turn(task.prompt);
  await wait(async () => (await fixture.status()).tasks[0]?.status === 'review', 'native task report', 30000);
  await wait(async () => (await rpc('thread/read', { threadId: threadID, includeTurns: true })).thread.turns.every(value => ['completed', 'failed', 'interrupted'].includes(value.status)), 'review notice stop');
  await turn(`TURNLINK_MANUAL_REVIEW:${task.taskID}`);
  await wait(async () => (await fixture.status()).tasks[0]?.status === 'completed', 'explicit master review');
  const result = await fixture.status(); assert.equal(result.tasks[0].status, 'completed');
  assert.ok(result.tasks[0].admissionID); assert.ok(result.tasks[0].stoppedEvidence); assert.equal(result.tasks[0].evidence.length, 1);
  const after = await rpc('thread/resume', { threadId: threadID, excludeTurns: true });
  assert.equal(after.thread.id, initial.thread.id); assert.equal(after.cwd, initial.cwd);
  assert.equal(after.model, initial.model); assert.deepEqual(after.sandbox, initial.sandbox); assert.deepEqual(after.approvalPolicy, initial.approvalPolicy);
  assert.equal(after.sandbox.type, 'readOnly');
  assert.equal(result.movementEnabled, false);
  t.diagnostic(JSON.stringify({ version, nativeRoleTaskFlow: true, sameThread: true, localProviderOnly: true,
    uiEvidence: 'pending manual observation', phases: result.phases, nativeAdmissionID: result.tasks[0].admissionID }));
});
