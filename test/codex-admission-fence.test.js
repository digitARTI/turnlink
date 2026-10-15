import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAdmissionFence } from '../src/codex-admission-fence.js';

function fixture(extra = {}) {
  const writes = [], replies = [], state = { known: true, idle: true, blocked: false, flushing: false };
  const fence = new CodexAdmissionFence({ write: (line, frame, internal) => writes.push({ line, frame, internal }),
    reply: value => replies.push(value), activity: () => state, ...extra });
  return { fence, writes, replies, state };
}

test('native fence holds mutations FIFO, allows audited reads, and cannot be acquired from RPC/model tokens', async () => {
  const { fence, writes } = fixture(); let old;
  await fence.exclusive('b', async ({ token }) => {
    old = token;
    fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' }, token: {} }));
    fence.editor(JSON.stringify({ id: 2, method: 'future/mutation', params: {} }));
    fence.editor(JSON.stringify({ id: 3, method: 'config/read', params: {} }));
    assert.deepEqual(writes.map(w => w.frame.id), [3]);
    assert.throws(() => fence.internal({ id: 'peer', method: 'turn/start', params: { threadId: 'b' } }), /NATIVE_ADMISSION_FENCED/);
    assert.throws(() => fence.internal({ id: 'forged', method: 'turn/start', params: { threadId: 'b' } }, {}), /NATIVE_FENCE_UNCERTAIN/);
    assert.throws(() => fence.internal({ id: 'wrong', method: 'turn/start', params: { threadId: 'other' } }, token), /NATIVE_FENCE_SCOPE_MISMATCH/);
    assert.throws(() => fence.internal({ id: 999, result: { decision: 'approved' } }, token), /INVALID_NATIVE_FENCE_REQUEST/);
    fence.observe({ id: 3, result: {} });
  });
  assert.deepEqual(writes.map(w => w.frame.id), [3, 1, 2]);
  assert.throws(() => fence.internal({ id: 'stale', method: 'turn/start', params: { threadId: 'b' } }, old), /NATIVE_FENCE_UNCERTAIN/);
  fence.close();
});

test('unknown lifecycle, pending mutation, active turns, blockers and in-flight adapter flush prevent acquisition', async () => {
  for (const field of ['known', 'idle', 'blocked', 'flushing']) {
    const { fence, state } = fixture(); state[field] = ['known', 'idle'].includes(field) ? false : true;
    await assert.rejects(fence.exclusive('b', async () => {}), /NATIVE_IDLE_REQUIRED/); fence.close();
  }
  const { fence } = fixture(); fence.editor(JSON.stringify({ id: 1, method: 'thread/resume', params: { threadId: 'b' } }));
  await assert.rejects(fence.exclusive('b', async () => {}), /NATIVE_IDLE_REQUIRED/);
  fence.observe({ id: 1, result: {} }); await fence.exclusive('b', async () => {}); fence.close();
  const other = fixture();
  other.fence.observe({ method: 'turn/started', params: { threadId: 'other', turn: { id: 'busy-other' } } });
  other.fence.observe({ method: 'thread/archived', params: { threadId: 'other' } });
  await assert.rejects(other.fence.exclusive('b', async () => {}), /NATIVE_IDLE_REQUIRED/);
  other.fence.observe({ method: 'turn/completed', params: { threadId: 'other', turn: { id: 'busy-other' } } });
  await other.fence.exclusive('b', async () => {}); other.fence.close();
});

test('owner-native mutation requires its own receipt and completed turn before held editor work is released', async () => {
  const { fence, state, writes } = fixture();
  await fence.exclusive('b', async ({ token }) => {
    fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b', input: [] } }, token);
    fence.observe({ id: 'owned', result: { turn: { id: 'owned-turn' } } });
    fence.observe({ method: 'turn/started', params: { threadId: 'b', turn: { id: 'owned-turn' } } }); state.idle = false;
    assert.throws(() => fence.internal({ id: 'wrong-turn', method: 'turn/interrupt', params: { threadId: 'b', turnId: 'foreign-turn' } }, token), /NATIVE_FENCE_SCOPE_MISMATCH/);
    fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' } }));
    assert.equal(writes.length, 1);
    fence.observe({ id: 999, method: 'item/commandExecution/requestApproval', params: { threadId: 'b' } }); state.blocked = true;
    fence.editor(JSON.stringify({ id: 999, result: { decision: 'approved' } })); state.blocked = false;
    assert.equal(writes.at(-1).frame.id, 999, 'actual user approval responses must pass unchanged');
    fence.observe({ method: 'turn/completed', params: { threadId: 'b', turn: { id: 'owned-turn', status: 'completed' } } }); state.idle = true;
  });
  assert.deepEqual(writes.map(w => w.frame.id), ['owned', 999, 1]); fence.close();
});

test('native response without start/completion evidence cannot release competing work', async () => {
  const { fence, writes } = fixture();
  await assert.rejects(fence.exclusive('b', async ({ token }) => {
    fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b' } }, token);
    fence.observe({ id: 'owned', result: { turn: { id: 'turn' } } });
    fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' } }));
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(fence.quarantined, true); assert.equal(writes.length, 1); fence.close();
});

test('start notifications correlate to the owning RPC turn ID, including notification-before-response ordering', async () => {
  const { fence } = fixture();
  await fence.exclusive('b', async ({ token }) => {
    fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b' } }, token);
    fence.observe({ method: 'turn/started', params: { threadId: 'b', turn: { id: 'actual' } } });
    fence.observe({ method: 'turn/completed', params: { threadId: 'b', turn: { id: 'actual' } } });
    fence.observe({ id: 'owned', result: { turn: { id: 'actual' } } });
  }); fence.close();
  const second = fixture();
  await assert.rejects(second.fence.exclusive('b', async ({ token }) => {
    second.fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b' } }, token);
    second.fence.observe({ method: 'turn/started', params: { threadId: 'b', turn: { id: 'foreign' } } });
    second.fence.observe({ id: 'owned', result: { turn: { id: 'actual' } } });
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(second.fence.quarantined, true); second.fence.close();
});

test('timeout or unexpected native activity invalidates owner capabilities and never drains uncertain work', async () => {
  const { fence, writes } = fixture({ timeoutMs: 15 }); let owner;
  await assert.rejects(fence.exclusive('b', async ({ token, signal }) => {
    owner = token;
    fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b' } }, token);
    fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' } }));
    await delay(30); assert.equal(signal.aborted, true);
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(fence.quarantined, true); assert.equal(writes.length, 1);
  assert.throws(() => fence.internal({ id: 'late', method: 'turn/start', params: { threadId: 'b' } }, owner), /NATIVE_FENCE_UNCERTAIN/);
  fence.close();
  const second = fixture();
  await assert.rejects(second.fence.exclusive('b', async () => {
    second.fence.observe({ method: 'turn/started', params: { threadId: 'b', turn: { id: 'unrequested' } } });
  }), /NATIVE_FENCE_UNCERTAIN/);
  second.fence.close();
});

test('bounded queues reject excess requests without logging or losing previously held work', async () => {
  const { fence, writes, replies } = fixture({ queueLimit: 1 });
  await fence.exclusive('b', async () => {
    fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { text: 'private-first' } }));
    fence.editor(JSON.stringify({ id: 2, method: 'turn/start', params: { text: 'secret-second' } }));
    assert.equal(replies[0].id, 2); assert.ok(!JSON.stringify(replies).includes('secret-second'));
  });
  assert.deepEqual(writes.map(w => w.frame.id), [1]); fence.close();
});

test('human interruption is never delayed by a fence and invalidates the owning transition', async () => {
  const { fence, writes, replies } = fixture();
  await assert.rejects(fence.exclusive('b', async ({ token, signal }) => {
    fence.internal({ id: 'owned', method: 'turn/start', params: { threadId: 'b' } }, token);
    fence.editor(JSON.stringify({ id: 'queued-user', method: 'turn/start', params: { threadId: 'b', input: [] } }));
    fence.editor(JSON.stringify({ id: 'human-stop', method: 'turn/interrupt', params: { threadId: 'b', turnId: 'turn' } }));
    assert.equal(writes.at(-1).frame.id, 'human-stop'); assert.equal(signal.aborted, true);
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(fence.quarantined, true); assert.equal(fence.queue.length, 0);
  assert.equal(replies[0].id, 'queued-user'); assert.equal(replies[0].error.code, -32098); fence.close();
});

test('live native stdio preserves notification/approval flow while competing editor admissions are fenced', async t => {
  const child = spawn(process.execPath, [resolve('test/fixtures/codex.js'), 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { known: true, idle: true, blocked: false, flushing: false }, frames = [];
  const fence = new CodexAdmissionFence({ write: line => child.stdin.write(`${line}\n`), reply: value => frames.push(value), activity: () => state });
  createInterface({ input: child.stdout }).on('line', line => {
    const frame = JSON.parse(line); fence.observe(frame); frames.push(frame);
    if (frame.method === 'turn/started') state.idle = false;
    if (frame.method === 'turn/completed') state.idle = true;
  });
  t.after(async () => { fence.close(); child.kill(); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); });
  const wait = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } throw new Error('native fence fixture timed out'); };
  await fence.exclusive('b', async ({ token }) => {
    fence.internal({ id: 'owned-start', method: 'turn/start', params: { threadId: 'b', input: [{ type: 'text', text: 'owned' }] } }, token);
    await wait(() => frames.some(f => f.method === 'turn/started'));
    fence.editor(JSON.stringify({ id: 'editor-start', method: 'turn/start', params: { threadId: 'b', input: [{ type: 'text', text: 'editor' }] } }));
    await delay(30); assert.ok(!frames.some(f => f.id === 'editor-start'));
    fence.internal({ id: 'owned-stop', method: 'turn/interrupt', params: { threadId: 'b', turnId: 'turn-active' } }, token);
    await wait(() => frames.some(f => f.method === 'turn/completed'));
  });
  await wait(() => frames.some(f => f.id === 'editor-start') && frames.filter(f => f.method === 'fixture/received' && f.params.method === 'turn/start').length === 2);
  assert.equal(frames.filter(f => f.method === 'fixture/received' && f.params.method === 'turn/start').length, 2);
});
