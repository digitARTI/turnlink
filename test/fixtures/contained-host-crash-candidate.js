import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ChannelClient } from '../../src/client.js';

const [previousID, nextID] = process.argv.slice(2), lost = process.argv.includes('--lost'), base = '/var/lib/turnlink/tmp';
const roots = readdirSync(base).filter(name => name.startsWith('turnlink-native-live-handoff-'));
assert.equal(roots.length, 1);
const options = { url: 'ws://127.0.0.1:31683', token: '1'.repeat(64), credentialDirectory: join(base, roots[0], 'proofs') };
const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), candidate = new ChannelClient(options), resumed = new ChannelClient(options), stale = new ChannelClient(options), replay = new ChannelClient(options), peer = new ChannelClient(options);
try {
  const transitions = await admin.request('control_query', { channel: 'dev', view: 'transitions', entityID: nextID });
  const grant = transitions.entries.find(entry => entry.id === nextID);
  assert.ok(grant);
  if (process.argv.includes('--expect-rejected')) {
    await assert.rejects(candidate.recoverContainedOwner('opencode:ses_movement', '3'.repeat(64), previousID, grant), /RECEIVER_HANDOFF_UNAVAILABLE/);
    process.stdout.write(JSON.stringify({ rejected: true }));
    process.exitCode = 0;
  } else {
  if (lost) {
    await assert.rejects(candidate.recoverContainedOwner('opencode:ses_movement', '3'.repeat(64), previousID, grant), /Timeout/);
    await delay(300);
    await resumed.resumeReceiverHandoff('opencode:ses_movement', nextID);
  } else {
    const result = await candidate.recoverContainedOwner('opencode:ses_movement', '3'.repeat(64), previousID, grant);
    assert.equal(result.transitionID, nextID);
  }
  await peer.request('join', { channel: 'dev', name: 'takeover-test-peer', role: 'fixture', harness: 'codex', sessionId: 'takeover-test-peer',
    project: { name: 'fixture', root: '/fixture' } });
  await peer.request('send', { agentId: 'codex:takeover-test-peer', to: 'opencode:ses_movement', messageId: 'held-after-takeover', text: 'held after takeover' });
  await delay(300);
  const tasks = await admin.request('control_query', { channel: 'dev', view: 'tasks' });
  assert.notEqual(tasks.entries.find(task => task.id === grant.taskID)?.status, 'running');
  candidate.close(); resumed.close(); await delay(300);
  await assert.rejects(stale.resumeReceiverHandoff('opencode:ses_movement', previousID));
  await assert.rejects(replay.recoverContainedOwner('opencode:ses_movement', '3'.repeat(64), previousID, grant));
  process.stdout.write(JSON.stringify({ transferred: true, staleRejected: true, replayRejected: true }));
  }
} finally { admin.close(); candidate.close(); resumed.close(); stale.close(); replay.close(); peer.close(); }
