import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ToolSession } from '../src/tools.js';
import { sessionRecord } from '../src/session-evidence.js';
import { ControlGateway } from '../src/control/gateway.js';

test('session watch recovery reports malformed broker history as a failure', async () => {
  const client = new EventEmitter();
  client.request = async method => {
    assert.equal(method, 'history');
    return { invalid: true };
  };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = 'codex:manager'; session.channel = 'dev';
  await assert.rejects(session.restoreSessionWatches(), /history unavailable/i);
  session.startSessionRecovery();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.sessionRecoveryFailed, true);
  session.stopSessionRecovery();
});

test('an active session watch exposes malformed history as requiring recovery', async () => {
  const task = { id: randomUUID(), claimant: 'opencode:worker' };
  const preview = { id: randomUUID(), from: '/source', to: '/destination' };
  const client = { async request(method) {
    if (method === 'members') return [{ agentId: task.claimant, project: { root: preview.from } }];
    if (method === 'history') return { invalid: true };
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = 'codex:manager'; session.channel = 'dev';
  const entry = { task, preview, channel: 'dev', owner: session.agentId, busy: false };
  session.sessionWatches = new Map([[preview.id, entry]]);
  await session.trySessionWatch(entry);
  assert.equal(entry.retryRequired, true);
});

test('operator review marks a missing original record as unavailable', () => {
  const task = { id: randomUUID(), channel: 'dev', claimant: 'opencode:worker', status: 'claimed', requiresWorktree: true, claimGeneration: 1 };
  const preview = { id: randomUUID(), taskID: task.id, agentId: task.claimant, channel: 'dev', from: '/source', to: '/destination',
    manualResume: true, approved: true, sessionCoordinator: 'codex:manager', claimGeneration: 1 };
  const observation = { taskID: task.id, previewID: preview.id, channel: 'dev', from: preview.from, to: preview.to,
    coordinator: preview.sessionCoordinator, claimGeneration: 1, recordID: randomUUID() };
  const gateway = Object.assign(Object.create(ControlGateway.prototype), {
    worktreeGrants: true, runtimeAvailable: () => true, store: { snapshot: () => ({ tasks: [task], previews: [preview] }) },
    manualPlacement: () => observation, messages: () => [], members: () => [], manualLocation: () => undefined,
  });
  const review = gateway.manualResumeReview({ channel: 'dev', taskID: task.id, previewID: preview.id });
  assert.equal(review.sourceRecord, null);
  assert.equal(review.report.status, 'awaiting_request');
});

test('join reads the connected self even if the member list is truncated', async () => {
  const self = { agentId: 'opencode:worker', connected: true, nameState: 'claimed' };
  const members = [{ agentId: 'codex:peer', connected: true }, self];
  const client = { async request(method, params) {
    if (method === 'join') return { agent: { ...self, connected: false, nameState: 'reserved' }, members: [] };
    if (method === 'members') return members.slice(params.offset, params.offset + 1);
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'opencode', sessionId: 'worker', onJoin: async () => {} });
  const result = await session.call('channel_join', { harness: 'opencode', sessionId: 'worker', channel: 'dev' });
  assert.deepEqual(result.agent, self);
});

test('manual preview finds its claimant when the broker returns a truncated member page', async () => {
  const taskID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const members = [{ agentId: owner, channel: 'dev' }, { agentId: claimant, channel: 'dev', connected: true, project: { root: '/source' } }];
  const offsets = [];
  const client = { async request(method, params) {
    if (method === 'members') { offsets.push(params.offset ?? 0); return members.slice(params.offset ?? 0, (params.offset ?? 0) + 1); }
    if (method === 'control_query' && params.view === 'channel') return { channel: { active: { agentId: owner, generation: 1 } } };
    if (method === 'control_query' && params.view === 'tasks') return { entries: [{ id: taskID, claimant, status: 'claimed', requiresWorktree: true }] };
    if (method === 'control_command') return { commandID: params.command.id };
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  assert.ok((await session.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID);
  assert.deepEqual(offsets, [0, 1]);
});

test('a destination claimant beyond the first member page triggers comparison', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const members = [{ agentId: owner }, { agentId: claimant, project: { root: '/destination' } }];
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) };
  const client = { async request(method, params) {
    if (method === 'members') return members.slice(params.offset, params.offset + 1);
    if (method === 'history') return [message];
    if (method === 'control_manual_resume_status') return { status: 'detached' };
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false }, calls = [];
  session.sessionWatches = new Map([[previewID, entry]]);
  session.call = async (name, args) => { calls.push({ name, args }); };
  await session.trySessionWatch(entry);
  assert.equal(calls[0]?.name, 'channel_verify_session');
  assert.equal(calls[0]?.args.messageId, `turnlink-verify-${message.id}`);
});

test('a transient broker rejection while observing the destination is retried without a new presence event', async t => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) };
  let observations = 0, comparisons = 0;
  const client = { async request(method) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/destination' } }];
    if (method === 'history') return [message];
    if (method === 'control_manual_resume_status') {
      if (++observations === 1) throw Object.assign(new Error('MANUAL_RESUME_UNAVAILABLE'), { code: 'MANUAL_RESUME_UNAVAILABLE' });
      return { status: 'detached' };
    }
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false };
  session.sessionWatches = new Map([[previewID, entry]]); t.after(() => session.clearSessionWatches());
  session.call = async () => { comparisons++; };
  await session.trySessionWatch(entry);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(observations, 2); assert.equal(comparisons, 1);
});

test('destination observation continues recovering after the initial retry window without another presence event', { timeout: 8000 }, async t => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) };
  let observations = 0, comparisons = 0;
  const client = { async request(method) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/destination' } }];
    if (method === 'history') return [message];
    if (method === 'control_manual_resume_status') {
      if (++observations === 1) throw Object.assign(new Error('MANUAL_RESUME_UNAVAILABLE'), { code: 'MANUAL_RESUME_UNAVAILABLE' });
      return { status: 'detached' };
    }
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false, retryCount: 6 };
  session.sessionWatches = new Map([[previewID, entry]]); t.after(() => session.clearSessionWatches());
  session.call = async () => { comparisons++; };
  await session.trySessionWatch(entry);
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(observations, 2); assert.equal(comparisons, 1);
});

test('an uncertain comparison send is not automatically repeated', async t => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) };
  const client = { async request(method) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/destination' } }];
    if (method === 'history') return [message];
    if (method === 'control_manual_resume_status') return { status: 'detached' };
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false }; let comparisons = 0;
  session.sessionWatches = new Map([[previewID, entry]]); t.after(() => session.clearSessionWatches());
  session.call = async () => { comparisons++; throw new Error('response lost'); };
  await session.trySessionWatch(entry);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(comparisons, 1); assert.equal(entry.retryRequired, true);
});

test('presence during a lost comparison reply reconciles history without repeating the send', async t => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true, sessionCoordinator: owner };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) };
  let committed;
  const client = { async request(method, params) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/destination' } }];
    if (method === 'history') return (committed ? [committed, message] : [message]).slice(params.offset || 0, (params.offset || 0) + params.limit);
    if (method === 'control_manual_resume_status') return { status: 'detached' };
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false }; let comparisons = 0;
  session.sessionWatches = new Map([[previewID, entry]]); t.after(() => session.clearSessionWatches());
  session.call = async () => {
    comparisons++;
    await session.trySessionWatch(entry); // Presence arrives while the send is in flight.
    throw new Error('response lost');
  };
  await session.trySessionWatch(entry);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(comparisons, 1);
  assert.equal(entry.retryRequired, true);
  assert.equal(entry.uncertainComparison, `turnlink-verify-${message.id}`);
  session.approvedSessionTask = async () => ({ task, preview });
  const status = await ToolSession.prototype.call.call(session, 'channel_session_status', { taskID, previewID });
  assert.equal(status.status, 'awaiting_request');
  assert.equal(status.watch.uncertainComparison, true);
  assert.equal(status.watch.comparisonMessageId, entry.uncertainComparison);
  assert.match(status.watch.guidance, /no longer in flight/);
  await session.trySessionWatch(entry);
  assert.equal(comparisons, 1, 'a missing history entry does not prove the send failed');
  committed = { messageId: entry.uncertainComparison, from: { agentId: owner }, to: claimant,
    text: `Turnlink requests a session comparison after a manual move. Task ${taskID}, approved preview ${previewID}, session ${claimant}, fixture` };
  await session.trySessionWatch(entry);
  assert.equal(comparisons, 1);
  assert.equal(session.sessionWatches.size, 0, 'the observed committed request resolves the watch without a second send');
});

test('an invalid session record prompts the claimant to correct it before arming', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'unknown', provider: null, permissions: null, work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) }, sent = [];
  const client = { async request(method, params) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/source' } }];
    if (method === 'history') return [message];
    if (method === 'control_query' && params.view === 'channel') return { channel: { active: { agentId: owner, generation: 1 } } };
    if (method === 'send') { sent.push(params); return { id: randomUUID() }; }
    throw new Error(`Unexpected ${method}`);
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false };
  session.sessionWatches = new Map([[previewID, entry]]);
  await session.trySessionWatch(entry);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, claimant);
  assert.match(sent[0].text, /null/i);
  assert.equal(sent[0].messageId, `turnlink-record-repair-${message.id}`);
  message.id = randomUUID();
  message.text = JSON.stringify({ ...record, model: null });
  await session.trySessionWatch(entry);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /cannot be armed while any observation is null/i);
});

test('an uncertain source is asked for a fresh record before rearming', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, claimant }, preview = { id: previewID, from: '/source', to: '/destination', manualResume: true };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  const message = { id: randomUUID(), from: { agentId: claimant }, to: owner, text: JSON.stringify(record) }, sent = [];
  const client = { async request(method, params) {
    if (method === 'members') return [{ agentId: claimant, project: { root: '/source' } }];
    if (method === 'history') return [message];
    if (method === 'control_query' && params.view === 'channel') return { channel: { active: { agentId: owner, generation: 1 } } };
    if (method === 'control_manual_resume_status') return { status: 'uncertain' };
    if (method === 'send') { sent.push(params); return { id: randomUUID() }; }
    throw new Error(`Unexpected ${method}`);
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  const entry = { task, preview, owner, channel: 'dev', busy: false };
  session.sessionWatches = new Map([[previewID, entry]]);
  await session.trySessionWatch(entry);
  await session.trySessionWatch(entry);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageId, `turnlink-record-refresh-${message.id}`);
  assert.match(sent[0].text, /new messageId/i);
});

test('session preparation reaches the claimant only for the approved current preview', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), sent = [];
  const task = { id: taskID, channel: 'dev', requiresWorktree: true, status: 'claimed', claimant: 'opencode:worker', claimGeneration: 2 };
  const preview = { id: previewID, taskID, channel: 'dev', agentId: task.claimant, claimGeneration: 2, approved: true, from: '/source', to: '/destination' };
  const client = { async request(method, params) {
    if (method === 'join') return { agent: { agentId: 'codex:manager' } };
    if (method === 'control_query' && params.view === 'channel') return { channel: { active: { agentId: 'codex:manager', generation: 1 } } };
    if (method === 'control_query') return { entries: [params.view === 'tasks' ? task : preview], next: 0 };
    if (method === 'control_command') { preview.sessionCoordinator = 'codex:manager'; return { commandID: params.command.id }; }
    if (method === 'send') { sent.push(params); return { accepted: true }; }
    throw new Error('Unexpected method');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  await session.call('channel_join', { harness: 'codex', sessionId: 'manager', channel: 'dev' });
  const args = { taskID, previewID, messageId: 'request-1' };
  assert.deepEqual(await session.call('channel_prepare_session', args), { accepted: true });
  assert.equal(sent[0].to, task.claimant);
  assert.match(sent[0].text, /do not guess/i);
  assert.match(sent[0].text, /external actions that may still finish/i);
  assert.match(sent[0].text, /cannot verify their status/i);
  assert.match(sent[0].text, /do not move the session/i);
  assert.match(sent[0].text, /complete sanitized record/i);
  await session.call('channel_verify_session', { ...args, messageId: 'request-2' });
  assert.equal(sent[1].to, task.claimant);
  assert.match(sent[1].text, /compare the actual session identity/i);
  assert.match(sent[1].text, /channel_history/i);
  assert.match(sent[1].text, /does not transfer the receiver/i);
  preview.claimGeneration = 1;
  await assert.rejects(session.call('channel_prepare_session', args), /Approved claimed worktree preview required/);
  preview.claimGeneration = 2; preview.approved = false;
  await assert.rejects(session.call('channel_prepare_session', args), /Approved claimed worktree preview required/);
  assert.equal(sent.length, 2);
});

test('a former coordinator cannot issue a new comparison after losing master authority', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), owner = 'codex:manager', claimant = 'opencode:worker';
  const task = { id: taskID, channel: 'dev', requiresWorktree: true, status: 'claimed', claimant, claimGeneration: 1 };
  const preview = { id: previewID, taskID, channel: 'dev', agentId: claimant, claimGeneration: 1, approved: true, from: '/source', to: '/destination', sessionCoordinator: owner };
  let sent = false;
  const client = { async request(method, params) {
    if (method === 'control_query' && params.view === 'channel') return { channel: { active: { agentId: 'codex:new-master', generation: 2 } } };
    if (method === 'control_query') return { entries: [params.view === 'tasks' ? task : preview], next: 0 };
    if (method === 'send') { sent = true; return {}; }
    throw new Error('Unexpected request');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = owner; session.channel = 'dev';
  await assert.rejects(session.call('channel_verify_session', { taskID, previewID, messageId: 'stale-master' }), /Active master required/);
  assert.equal(sent, false);
});

test('structured comparison identifies differences and never treats an unknown baseline as a match', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), requestID = randomUUID(), recordID = randomUUID();
  const task = { id: taskID, channel: 'dev', requiresWorktree: true, status: 'claimed', claimant: 'opencode:worker', claimGeneration: 1 };
  const preview = { id: previewID, taskID, channel: 'dev', agentId: task.claimant, claimGeneration: 1, approved: true, from: '/source', to: '/destination', sessionCoordinator: 'codex:manager' };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: task.claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'model', provider: 'provider', permissions: 'read-only', work: 'saved' };
  assert.equal(sessionRecord.safeParse({ ...record, model: 'unknown' }).success, false);
  for (const field of ['model', 'provider', 'permissions', 'work'])
    assert.equal(sessionRecord.safeParse({ ...record, [field]: ' \t\n ' }).success, false, `${field} cannot be an empty observation`);
  assert.equal(sessionRecord.safeParse({ ...record, model: null }).success, true);
  assert.equal(sessionRecord.safeParse({ ...record, runtime: 'opencode unknown' }).success, false);
  assert.equal(sessionRecord.safeParse({ ...record, runtime: 'opencode 2.2.5' }).success, true);
  assert.equal(sessionRecord.safeParse({ ...record, runtime: 'codex 2.2.5' }).success, false);
  assert.equal(sessionRecord.safeParse({ ...record, session: 'toString:worker', runtime: 'opencode 2.2.5' }).success, false);
  assert.equal(sessionRecord.safeParse({ ...record, session: 'codex:worker', runtime: 'codex-cli 0.165.0' }).success, true);
  assert.equal(sessionRecord.safeParse({ ...record, session: 'claude:worker', runtime: 'Claude Code 2.1.317' }).success, true);
  const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: task.claimant, recordID, requestID,
    runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  const newer = [];
  const history = () => [
    ...newer,
    { id: randomUUID(), from: { agentId: task.claimant }, to: 'codex:manager', text: JSON.stringify(report) },
    { id: requestID, from: { agentId: 'codex:manager' }, to: task.claimant,
      text: `Turnlink requests a session comparison after a manual move. Task ${taskID}, approved preview ${previewID}, session ${task.claimant},` },
    { id: recordID, from: { agentId: task.claimant }, to: 'codex:manager', text: JSON.stringify(record) },
  ];
  const client = { async request(method, params) {
    if (method === 'control_query') return { entries: [params.view === 'tasks' ? task : preview], next: 0 };
    // The broker may truncate a page below its requested count to fit a frame.
    if (method === 'history') return history().slice(params.offset, params.offset + 1);
    throw new Error('Unexpected method');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' });
  session.agentId = 'codex:manager'; session.channel = 'dev';
  const status = () => session.call('channel_session_status', { taskID, previewID });
  assert.equal((await status()).status, 'reported_match');
  record.work = '   ';
  assert.equal((await status()).status, 'invalid_record', 'a blank work summary cannot validate a reported match');
  record.work = 'saved';
  record.runtime = 'OpenCode v1.0.0';
  assert.equal((await status()).status, 'reported_match', 'product capitalization and the optional version prefix do not change the runtime');
  record.runtime = 'opencode 1.0.0-ALPHA'; report.runtime = 'opencode 1.0.0-alpha';
  const mismatch = await status();
  assert.equal(mismatch.status, 'invalid_report', 'prerelease identifiers are not case-normalized');
  assert.equal(mismatch.reason, 'runtime_values_do_not_match');
  assert.deepEqual(mismatch.runtime, { source: 'opencode 1.0.0-ALPHA', destination: 'opencode 1.0.0-alpha' });
  record.runtime = 'opencode 1.0.0';
  report.runtime = 'opencode 2.0.0';
  assert.equal((await status()).status, 'invalid_report', 'a claimed match must agree with the destination runtime value');
  report.runtime = 'opencode 1.0.0';
  report.checks.runtime = 'different';
  assert.equal((await status()).status, 'differences');
  report.checks.runtime = 'match'; record.runtime = null;
  assert.equal((await status()).status, 'invalid_report');
  report.checks.runtime = 'unknown';
  assert.equal((await status()).status, 'incomplete');
  record.runtime = 'opencode 1.0.0'; report.checks.runtime = 'match';
  newer.push({ id: randomUUID(), from: { agentId: task.claimant }, to: 'codex:manager',
    text: JSON.stringify({ ...record, type: 'turnlink.session_record.v1' }) });
  assert.equal((await status()).status, 'invalid_record', 'a legacy record must not revive an older v2 comparison');
  newer.length = 0;
  newer.push({ id: randomUUID(), from: { agentId: task.claimant }, to: 'codex:manager',
    text: `Malformed turnlink.session_record.v2 for task ${taskID} preview ${previewID}` });
  assert.equal((await status()).status, 'invalid_record', 'a newer malformed record must not revive an older matching report');
  newer.length = 0;
  record.permissions = null;
  assert.equal((await status()).status, 'invalid_report');
  report.checks.permissions = 'unknown';
  assert.equal((await status()).status, 'incomplete');
  report.checks.destination = 'different';
  assert.equal((await status()).status, 'differences');
});

test('manual comparison never reports a match without the broker-bound original record', async () => {
  const taskID = randomUUID(), previewID = randomUUID(), recordID = randomUUID(), requestID = randomUUID();
  const task = { id: taskID, channel: 'dev', requiresWorktree: true, status: 'claimed', claimant: 'opencode:worker', claimGeneration: 1 };
  const preview = { id: previewID, taskID, channel: 'dev', agentId: task.claimant, claimGeneration: 1, approved: true,
    manualResume: true, from: '/source', to: '/destination', sessionCoordinator: 'codex:manager' };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: task.claimant, source: preview.from, destination: preview.to,
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: task.claimant, recordID, requestID, runtime: 'opencode 1.0.0',
    checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  const history = [{ id: randomUUID(), from: { agentId: task.claimant }, to: preview.sessionCoordinator, text: JSON.stringify(report) },
    { id: requestID, from: { agentId: preview.sessionCoordinator }, to: task.claimant,
      text: `Turnlink requests a session comparison after a manual move. Task ${taskID}, approved preview ${previewID}, session ${task.claimant},` },
    { id: recordID, from: { agentId: task.claimant }, to: preview.sessionCoordinator, text: JSON.stringify(record) }];
  let baseline = { status: 'detached' };
  const client = { async request(method, params) {
    if (method === 'control_query') return { entries: [params.view === 'tasks' ? task : preview], next: 0 };
    if (method === 'history') return history.slice(params.offset, params.offset + 100);
    if (method === 'control_manual_resume_status') return baseline;
    throw new Error('Unexpected method');
  } };
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'manager' }); session.agentId = preview.sessionCoordinator; session.channel = 'dev';
  const status = () => session.call('channel_session_status', { taskID, previewID });
  assert.equal((await status()).status, 'baseline_unavailable', 'older broker responses cannot establish the original record');
  baseline = { baselineMatches: false, currentRecordID: recordID };
  assert.equal((await status()).reason, 'record_differs_from_baseline');
  baseline = { baselineMatches: true, currentRecordID: randomUUID() };
  assert.equal((await status()).status, 'baseline_unavailable', 'a racing record change cannot be reported as a match');
  baseline.currentRecordID = recordID;
  assert.equal((await status()).status, 'reported_match');
});
