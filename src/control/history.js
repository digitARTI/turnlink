import { transitionHoldsConversation } from './worktree-holds.js';
import { UUID } from './contracts.js';
export const HISTORY_KINDS = ['tasks', 'actions', 'incidents', 'evidence', 'previews', 'transitions', 'managedPreviews'];
export const entityLimit = kind => kind === 'evidence' ? 16384 : 4096;

export const ARCHIVED_TEXT = '[private archived collaboration text]';
export const taskPayload = task => ({ title: task.title, instructions: task.instructions, criteria: task.criteria,
  ...(task.result ? { summary: task.result.summary } : {}) });
export function putTaskPayload(task, payload) {
  Object.assign(task, { title: payload.title, instructions: payload.instructions, criteria: payload.criteria });
  if (task.result && payload.summary !== undefined) task.result.summary = payload.summary;
}
export function compactTask(task) {
  task.title = ARCHIVED_TEXT; task.instructions = ARCHIVED_TEXT; task.criteria = ARCHIVED_TEXT;
  if (task.result) task.result.summary = ARCHIVED_TEXT;
}

// Keep both directions of UUID references. For example, an open dependent pins
// its completed prerequisites, which pin their stop/artifact evidence and the
// previews/transitions/managed cleanup records referring to those tasks.
export function protectedHistory(state, notices, before = 0) {
  const records = ['tasks', 'actions', 'incidents', 'evidence', 'previews', 'transitions', 'managedPreviews'].flatMap(kind => state[kind]);
  const protectedIDs = new Set(), channels = new Set();
  const seed = row => { protectedIDs.add(row.id); channels.add(row.channel); };
  for (const row of state.tasks) if (row.terminalHold || !['completed', 'cancelled'].includes(row.status)) seed(row);
  for (const row of state.actions) if (!['succeeded', 'failed', 'rejected'].includes(row.status)) seed(row);
  for (const row of state.incidents) if (row.status === 'open') seed(row);
  for (const row of state.transitions) if (transitionHoldsConversation(row)) seed(row);
  // Managed receipts remain operational cleanup authority even after creation.
  // Pin every managed record and its task rather than infer resource absence.
  for (const row of state.managedPreviews) {
    const closed = (row.status === 'removed' && row.settledAt < before && state.managedPreviews.some(source => source.id === row.preview.resourceID && source.status === 'created')) ||
      (row.status === 'created' && state.managedPreviews.some(other => other.preview.resourceID === row.id && other.status === 'removed' && other.settledAt < before));
    if (!closed) seed(row);
  }
  for (const channel of state.channels) for (const row of [channel.active, channel.proposal, channel.election].filter(Boolean)) {
    protectedIDs.add(row.id); channels.add(channel.id);
  }
  for (const notice of notices) if (notice.status === 'pending') { seed(notice); protectedIDs.add(notice.assignmentID); if (notice.taskID) protectedIDs.add(notice.taskID); }
  const references = value => {
    if (typeof value === 'string') return value.length === 36 && UUID.safeParse(value).success ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(references);
    return value && typeof value === 'object' ? Object.values(value).flatMap(references) : [];
  };
  const graph = records.map(row => ({ row, refs: references(row) }));
  let changed;
  do {
    changed = false;
    for (const { row, refs } of graph) if (refs.some(id => protectedIDs.has(id))) {
      channels.add(row.channel);
      for (const id of refs) if (!protectedIDs.has(id)) { protectedIDs.add(id); changed = true; }
    }
  } while (changed);
  return { ids: protectedIDs, channels };
}
