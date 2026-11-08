import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { privateDirectory, readPrivate } from './storage.js';
import { Channel } from './protocol.js';

const Selection = z.strictObject({ version: z.literal(1), channel: Channel,
  taskID: z.string().uuid(), previewID: z.string().uuid() });

async function allPages(client, channel, view) {
  const entries = [];
  for (let offset = 0; offset <= 10000;) {
    const page = await client.request('control_query', { channel, view, offset, limit: 100 });
    if (!Array.isArray(page?.entries) || !Number.isSafeInteger(page.next) || page.next !== offset + page.entries.length)
      throw new Error('Manual move discovery returned an invalid page');
    if (!page.entries.length) return entries;
    entries.push(...page.entries); offset = page.next;
  }
  throw new Error('Manual move discovery exceeded its query budget');
}

// A selection is only a pointer, not an approval or a capability. Every later
// action must re-read current broker state and use the existing broker checks.
export async function selectManualResume(client, channel, memberName) {
  Channel.parse(channel);
  if (memberName !== undefined && (typeof memberName !== 'string' || !memberName || memberName.length > 128)) throw new Error('Member name required');
  let namedAgent;
  if (memberName !== undefined) {
    const matches = [];
    for (let offset = 0; offset <= 10000;) {
      const page = await client.request('members', { channel, offset, limit: 100 });
      if (!Array.isArray(page)) throw new Error('Manual move member discovery unavailable');
      if (!page.length) break;
      matches.push(...page.filter(member => member.channel === channel && member.name === memberName));
      offset += page.length;
      if (offset > 10000) throw new Error('Manual move member discovery exceeded its query budget');
    }
    if (matches.length !== 1 || typeof matches[0].agentId !== 'string') {
      const error = new Error('Member name is missing or ambiguous'); error.code = 'MANUAL_SELECTION_NAME_UNAVAILABLE'; throw error;
    }
    namedAgent = matches[0].agentId;
  }
  const [tasks, previews] = await Promise.all([allPages(client, channel, 'tasks'), allPages(client, channel, 'previews')]);
  const latest = new Map();
  for (const preview of previews) latest.set(`${preview.taskID}:${preview.agentId}`, preview);
  const candidates = [];
  for (const task of tasks) {
    if (task.channel !== channel || task.status !== 'claimed' || task.requiresWorktree !== true || !task.claimant ||
        (namedAgent !== undefined && task.claimant !== namedAgent)) continue;
    const preview = latest.get(`${task.id}:${task.claimant}`);
    if (!preview || preview.channel !== channel || preview.manualResume !== true || preview.approved !== true) continue;
    try {
      const review = await client.request('control_manual_resume_review', { channel, taskID: task.id, previewID: preview.id });
      if (review.taskID !== task.id || review.previewID !== preview.id || review.agentId !== task.claimant)
        throw new Error('Manual move review identity mismatch');
      candidates.push({ selection: Selection.parse({ version: 1, channel, taskID: task.id, previewID: preview.id }), review });
    } catch (error) {
      if (error.message !== 'MANUAL_RESUME_UNAVAILABLE') throw error;
    }
  }
  if (candidates.length !== 1) {
    const error = new Error(candidates.length ? 'Multiple manual moves are available' : 'No manual move is ready for review');
    error.code = candidates.length ? 'MANUAL_SELECTION_AMBIGUOUS' : 'MANUAL_SELECTION_UNAVAILABLE';
    throw error;
  }
  return candidates[0];
}

export function saveManualSelection(path, selection) {
  if (!isAbsolute(path)) throw new Error('An absolute private selection-file path is required');
  privateDirectory(dirname(path));
  writeFileSync(path, JSON.stringify(Selection.parse(selection)), { flag: 'wx', mode: 0o600 });
}

export function readManualSelection(path) {
  if (!isAbsolute(path)) throw new Error('An absolute private selection-file path is required');
  return Selection.parse(JSON.parse(readPrivate(path, 4096)));
}
