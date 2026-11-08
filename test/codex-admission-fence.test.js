import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAdmissionFence, requireCodexPublicationBarrier } from '../src/codex-admission-fence.js';

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

test('publication waits for earlier reads and holds new reads until the owner completes it', async () => {
  const { fence, writes } = fixture();
  let savedGuard;
  await fence.exclusive('b', async ({ beginPublication, endPublication, publicationGuard }) => {
    savedGuard = publicationGuard;
    assert.throws(() => requireCodexPublicationBarrier(() => {}), /NATIVE_PUBLICATION_FENCED/);
    assert.throws(() => requireCodexPublicationBarrier(publicationGuard), /NATIVE_PUBLICATION_FENCED/);
    fence.editor(JSON.stringify({ id: 1, method: 'thread/read', params: { threadId: 'b' } }));
    let ready = false; const beginning = beginPublication().then(() => { ready = true; });
    fence.editor(JSON.stringify({ id: 2, method: 'thread/turns/list', params: { threadId: 'b' } }));
    fence.editor(JSON.stringify({ id: 3, method: 'turn/start', params: { threadId: 'b' } }));
    assert.deepEqual(writes.map(w => w.frame.id), [1]);
    assert.throws(() => fence.internal({ id: 4, method: 'thread/read', params: { threadId: 'b' } }), /NATIVE_PUBLICATION_FENCED/);
    assert.throws(endPublication, /NATIVE_PUBLICATION_FENCED/);
    assert.equal(ready, false); fence.observe({ id: 1, result: {} }); await beginning;
    assert.equal(ready, true); assert.deepEqual(writes.map(w => w.frame.id), [1]);
    requireCodexPublicationBarrier(publicationGuard);
    assert.throws(() => requireCodexPublicationBarrier(publicationGuard, 'another-thread'), /NATIVE_PUBLICATION_FENCED/);
    endPublication(); assert.deepEqual(writes.map(w => w.frame.id), [1, 2]);
    assert.throws(() => requireCodexPublicationBarrier(publicationGuard), /NATIVE_PUBLICATION_FENCED/);
    fence.observe({ id: 2, result: {} });
  });
  assert.throws(() => requireCodexPublicationBarrier(savedGuard), /NATIVE_FENCE_UNCERTAIN/);
  assert.deepEqual(writes.map(w => w.frame.id), [1, 2, 3]); fence.close();
});

test('failed or interrupted publication never drains queued reads or mutations', async t => {
  for (const mode of ['failure', 'interrupt', 'expiry']) await t.test(mode, async () => {
    const { fence, writes } = fixture({ timeoutMs: 20 });
    await assert.rejects(fence.exclusive('b', async ({ beginPublication, endPublication }) => {
      if (mode === 'expiry') fence.editor(JSON.stringify({ id: 1, method: 'thread/read', params: { threadId: 'b' } }));
      const beginning = beginPublication();
      fence.editor(JSON.stringify({ id: 2, method: 'config/read', params: {} }));
      fence.editor(JSON.stringify({ id: 3, method: 'turn/start', params: { threadId: 'b' } }));
      if (mode === 'expiry') await beginning;
      else {
        await beginning;
        if (mode === 'interrupt') {
          fence.editor(JSON.stringify({ id: 4, method: 'turn/interrupt', params: { threadId: 'b', turnId: 't' } }));
          assert.throws(endPublication, /NATIVE_FENCE_UNCERTAIN/);
        }
        throw new Error('fixture publication failure');
      }
    }));
    assert.equal(fence.quarantined, true);
    assert.deepEqual(writes.map(w => w.frame.id), mode === 'expiry' ? [1] : mode === 'interrupt' ? [4] : []);
    fence.close();
  });
});

test('an unexpected native approval request invalidates the publication barrier', async () => {
  const { fence, writes } = fixture();
  await assert.rejects(fence.exclusive('b', async ({ beginPublication, endPublication }) => {
    await beginPublication(); fence.editor(JSON.stringify({ id: 2, method: 'config/read', params: {} }));
    fence.observe({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'b' } });
    assert.throws(endPublication, /NATIVE_FENCE_UNCERTAIN/);
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(fence.quarantined, true); assert.equal(writes.length, 0); fence.close();
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

test('overlapping request IDs cannot hide an in-flight mutation behind a read response', async () => {
  const { fence } = fixture();
  fence.editor(JSON.stringify({ id: 7, method: 'turn/start', params: { threadId: 'b' } }));
  fence.editor(JSON.stringify({ id: 7, method: 'thread/read', params: { threadId: 'b' } }));
  fence.observe({ id: 7, result: {} });
  await assert.rejects(fence.exclusive('b', async () => {}), /NATIVE_IDLE_REQUIRED/);
  assert.equal(fence.unknownNativeActivity, true);
  fence.close();
});

test('unknown native activity blocks internal writers while preserving human interruption', async () => {
  const { fence, writes } = fixture();
  fence.observeUnknownOutput();
  assert.throws(() => fence.internal({ id: 'background', method: 'turn/start', params: { threadId: 'b' } }), /NATIVE_FENCE_UNCERTAIN/);
  fence.editor(JSON.stringify({ id: 'stop', method: 'turn/interrupt', params: { threadId: 'b', turnId: 't' } }));
  assert.deepEqual(writes.map(value => value.frame.id), ['stop']);
  await assert.rejects(fence.exclusive('b', async () => {}), /NATIVE_IDLE_REQUIRED/);
  fence.close();
});

test('overlapping request IDs invalidate an active owner', async () => {
  const { fence, writes } = fixture();
  await assert.rejects(fence.exclusive('b', async () => {
    fence.editor(JSON.stringify({ id: 'queued', method: 'turn/start', params: { threadId: 'b' } }));
    fence.editor(JSON.stringify({ id: 7, method: 'thread/read', params: { threadId: 'b' } }));
    fence.editor(JSON.stringify({ id: 7, method: 'config/read', params: {} }));
    fence.observe({ id: 7, result: {} });
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.equal(fence.quarantined, true);
  assert.deepEqual(writes.map(value => value.frame.id), [7, 7]);
  fence.close();
});

test('changed or unavailable activity at release keeps queued editor work quarantined', async t => {
  for (const field of ['known', 'idle', 'blocked', 'flushing', 'unavailable']) await t.test(field, async () => {
    const { fence, state, writes } = fixture(field === 'unavailable' ? { activity: (() => {
      let calls = 0;
      return () => { if (++calls > 1) throw new Error('activity unavailable'); return { known: true, idle: true, blocked: false, flushing: false }; };
    })() } : {});
    await assert.rejects(fence.exclusive('b', async () => {
      fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' } }));
      if (field !== 'unavailable') state[field] = ['known', 'idle'].includes(field) ? false : true;
    }));
    assert.equal(fence.quarantined, true);
    assert.equal(fence.queue.length, 1);
    assert.deepEqual(writes, []);
    fence.close();
  });
});

test('a failed callback drains only if fresh activity still proves the process idle', async () => {
  for (const busy of [false, true]) {
    const { fence, state, writes } = fixture();
    await assert.rejects(fence.exclusive('b', async () => {
      fence.editor(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'b' } }));
      state.idle = !busy;
      throw new Error('callback failed');
    }), /callback failed/);
    assert.equal(fence.quarantined, busy);
    assert.equal(writes.length, busy ? 0 : 1);
    fence.close();
  }
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
  assert.equal(second.fence.quarantined, true);
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

test('an interruption of another thread also keeps competing admissions fenced', async t => {
  for (const response of [false, true]) await t.test(response ? 'response received' : 'response pending', async () => {
    const { fence, writes } = fixture();
    await assert.rejects(fence.exclusive('b', async () => {
      fence.editor(JSON.stringify({ id: 'queued', method: 'turn/start', params: { threadId: 'b' } }));
      fence.editor(JSON.stringify({ id: 'stop-other', method: 'turn/interrupt', params: { threadId: 'other', turnId: 'other-turn' } }));
      if (response) fence.observe({ id: 'stop-other', result: {} });
    }), /NATIVE_FENCE_UNCERTAIN/);
    assert.deepEqual(writes.map(value => value.frame.id), ['stop-other']);
    assert.equal(fence.quarantined, true);
    assert.equal(fence.queue.length, 1);
    fence.close();
  });
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

test('publication barrier drains a real in-flight stdio read before forwarding the next read', async t => {
  const child = spawn(process.execPath, [resolve('test/fixtures/codex-publication-read.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = [], fence = new CodexAdmissionFence({ write: line => child.stdin.write(`${line}\n`), reply() {},
    activity: () => ({ known: true, idle: true, blocked: false, flushing: false }) });
  createInterface({ input: child.stdout }).on('line', line => { const frame = JSON.parse(line); fence.observe(frame); frames.push(frame); });
  t.after(async () => { fence.close(); child.kill(); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); });
  const wait = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } throw new Error('publication fixture timed out'); };
  await fence.exclusive('b', async ({ beginPublication, endPublication }) => {
    fence.editor(JSON.stringify({ id: 'before', method: 'thread/read', params: { threadId: 'b' } }));
    const beginning = beginPublication();
    fence.editor(JSON.stringify({ id: 'after', method: 'config/read', params: {} }));
    await wait(() => frames.some(frame => frame.method === 'fixture/received' && frame.params.id === 'before'));
    assert.ok(!frames.some(frame => frame.method === 'fixture/received' && frame.params.id === 'after'));
    await beginning;
    assert.equal(frames.find(frame => frame.id === 'before')?.result.phase, 'before');
    assert.ok(!frames.some(frame => frame.method === 'fixture/received' && frame.params.id === 'after'));
    endPublication();
    await wait(() => frames.some(frame => frame.id === 'after'));
    assert.equal(frames.find(frame => frame.id === 'after').result.phase, 'after');
  });
});
