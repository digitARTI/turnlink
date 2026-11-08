import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chmodSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { selectManualResume, saveManualSelection, readManualSelection } from '../src/manual-resume-selection.js';

const make = () => {
  const task = { id: randomUUID(), channel: 'dev', claimant: 'codex:worker', status: 'claimed', requiresWorktree: true };
  const preview = { id: randomUUID(), channel: 'dev', taskID: task.id, agentId: task.claimant, manualResume: true, approved: true };
  return { task, preview };
};
const fixture = ({ tasks, previews, members = [], unavailable = new Set() }) => ({ async request(method, params) {
  if (method === 'members') return members.slice(params.offset, params.offset + params.limit);
  if (method === 'control_query') {
    const entries = (params.view === 'tasks' ? tasks : previews).slice(params.offset, params.offset + params.limit);
    return { entries, next: params.offset + entries.length };
  }
  if (method === 'control_manual_resume_review') {
    if (unavailable.has(params.previewID)) throw new Error('MANUAL_RESUME_UNAVAILABLE');
    const task = tasks.find(value => value.id === params.taskID);
    return { taskID: params.taskID, previewID: params.previewID, agentId: task.claimant, status: 'detached' };
  }
  throw new Error('Unexpected request');
} });

test('unique current manual move can be saved and reloaded without copying IDs', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-selection-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const { task, preview } = make(), stale = { ...preview, id: randomUUID() };
  const { selection, review } = await selectManualResume(fixture({ tasks: [task], previews: [stale, preview] }), 'dev');
  assert.equal(selection.previewID, preview.id); assert.equal(review.agentId, task.claimant);
  const file = join(root, 'selected.json'); saveManualSelection(file, selection);
  assert.deepEqual(readManualSelection(file), selection);
  assert.throws(() => saveManualSelection(file, selection), /EEXIST/);
  writeFileSync(file, JSON.stringify({ ...selection, extra: 'unexpected' }));
  assert.throws(() => readManualSelection(file));
});

test('multiple current moves fail closed and stale moves are not selected', async () => {
  const a = make(), b = make(), tasks = [a.task, b.task], previews = [a.preview, b.preview];
  await assert.rejects(selectManualResume(fixture({ tasks, previews }), 'dev'), { code: 'MANUAL_SELECTION_AMBIGUOUS' });
  const result = await selectManualResume(fixture({ tasks, previews, unavailable: new Set([b.preview.id]) }), 'dev');
  assert.equal(result.selection.taskID, a.task.id);
  await assert.rejects(selectManualResume(fixture({ tasks, previews, unavailable: new Set(previews.map(p => p.id)) }), 'dev'),
    { code: 'MANUAL_SELECTION_UNAVAILABLE' });
});

test('a second candidate beyond the first page is not silently ignored', async () => {
  const a = make(), b = make();
  const completed = Array.from({ length: 100 }, () => ({ ...make().task, status: 'completed' }));
  const irrelevant = completed.map(task => ({ id: randomUUID(), channel: 'dev', taskID: task.id, agentId: task.claimant }));
  const client = fixture({ tasks: [a.task, ...completed, b.task], previews: [a.preview, ...irrelevant, b.preview] });
  await assert.rejects(selectManualResume(client, 'dev'), { code: 'MANUAL_SELECTION_AMBIGUOUS' });
});

test('an exact member name selects the intended move without an agent ID', async () => {
  const a = make(), b = make(); b.task.claimant = 'codex:other'; b.preview.agentId = b.task.claimant;
  const members = [{ channel: 'dev', name: 'first', agentId: a.task.claimant }, { channel: 'dev', name: 'second', agentId: b.task.claimant }];
  const client = fixture({ tasks: [a.task, b.task], previews: [a.preview, b.preview], members });
  assert.equal((await selectManualResume(client, 'dev', 'second')).selection.taskID, b.task.id);
  await assert.rejects(selectManualResume(client, 'dev', 'Second'), { code: 'MANUAL_SELECTION_NAME_UNAVAILABLE' });
  members.push({ channel: 'dev', name: 'second', agentId: a.task.claimant });
  await assert.rejects(selectManualResume(client, 'dev', 'second'), { code: 'MANUAL_SELECTION_NAME_UNAVAILABLE' });
});

test('discovery fails closed on malformed pages and broker errors', async () => {
  await assert.rejects(selectManualResume({ request: async () => ({ entries: [], next: 999 }) }, 'dev'), /invalid page/);
  const { task, preview } = make(), client = fixture({ tasks: [task], previews: [preview] });
  const request = client.request; client.request = (method, params) => method === 'control_manual_resume_review'
    ? Promise.reject(new Error('broker disconnected')) : request(method, params);
  await assert.rejects(selectManualResume(client, 'dev'), /broker disconnected/);
});

test('selection files with unsafe permissions or symlink paths are rejected', { skip: process.platform === 'win32' }, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-selection-security-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const { task, preview } = make(), file = join(root, 'selected.json');
  const selection = { version: 1, channel: 'dev', taskID: task.id, previewID: preview.id };
  saveManualSelection(file, selection); chmodSync(file, 0o644);
  assert.throws(() => readManualSelection(file), /mode 0600/);
  chmodSync(file, 0o600); const link = join(root, 'link.json'); symlinkSync(file, link);
  assert.throws(() => readManualSelection(link), /regular file/);
});
