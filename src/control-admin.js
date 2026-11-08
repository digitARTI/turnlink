#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { ChannelClient } from './client.js';
import { adminToken } from './config.js';
import { privateDirectory } from './storage.js';
import { diagnosticCode } from './diagnostics.js';
import { Command, WorktreePreview } from './control/contracts.js';
import { discloseWorktreeApproval, worktreeApprovalForPreview, managedWorktreeReview } from './control-admin-approval.js';
import { downloadControlExport } from './control-export-client.js';
import { watchNotifications } from './notification-watch.js';
import { ControlError } from './control/policy.js';
import { selectManualResume, saveManualSelection, readManualSelection } from './manual-resume-selection.js';
import { manualResumeGuidance, manualResumeLimitations } from './manual-resume-guidance.js';
import { AgentID } from './protocol.js';

// Local human/operator interface only. Never register this program as a model tool or expose its credentials to a browser.
let [operation, ...args] = process.argv.slice(2);
let client;
try {
  client = new ChannelClient({ token: adminToken(false) });
  if (['manual-resume-review-selected', 'manual-resume-authorize-selected', 'manual-resume-confirm-selected',
    'manual-resume-cancel-selected', 'manual-resume-reset-selected', 'manual-resume-takeover-selected',
    'manual-resume-takeover-cancel-selected'].includes(operation)) {
    const original = operation, [file, ...rest] = args;
    if (!file || (['manual-resume-review-selected', 'manual-resume-cancel-selected', 'manual-resume-reset-selected',
      'manual-resume-takeover-selected', 'manual-resume-takeover-cancel-selected'].includes(original) && rest.length !== 0) ||
        (original === 'manual-resume-authorize-selected' && (rest.length < 1 || rest.length > 2)) ||
        (original === 'manual-resume-confirm-selected' && rest.length > 1)) throw new Error('Invalid selected manual-resume arguments');
    const selection = readManualSelection(file);
    operation = ({ 'manual-resume-review-selected': 'manual-resume-review', 'manual-resume-authorize-selected': 'manual-resume-authorize-host',
      'manual-resume-confirm-selected': 'manual-resume-confirm', 'manual-resume-cancel-selected': 'manual-resume-cancel-host',
      'manual-resume-reset-selected': 'manual-resume-reset', 'manual-resume-takeover-selected': 'manual-resume-takeover',
      'manual-resume-takeover-cancel-selected': 'manual-resume-takeover-cancel' })[original];
    args = [selection.channel, selection.taskID, selection.previewID, ...rest];
    if (original === 'manual-resume-cancel-selected') {
      const { channel, taskID, previewID } = selection;
      const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
      if (!review.hostTransfer?.id) throw new Error('No recorded host transfer to cancel');
      args.push(review.hostTransfer.id);
    }
    if (original === 'manual-resume-takeover-selected' || original === 'manual-resume-takeover-cancel-selected') {
      const { channel, taskID, previewID } = selection;
      let proposal;
      try { proposal = await client.request('control_manual_resume_takeover_prepare', { channel, taskID, previewID }); }
      catch (error) { if (error.message !== 'MANUAL_RESUME_UNAVAILABLE') throw error; }
      if (original === 'manual-resume-takeover-cancel-selected') {
        if (proposal?.pending !== true || !proposal.takeoverID) {
          const error = new Error('No pending coordinator takeover to cancel'); error.code = 'MANUAL_TAKEOVER_NOT_PENDING'; throw error;
        }
        args.push(proposal.takeoverID);
      } else {
        const state = await client.request('control_query', { channel, view: 'channel' });
        const active = AgentID.safeParse(state?.channel?.active?.agentId);
        const nextCoordinator = proposal?.pending === true ? proposal.nextCoordinator : active.success ? active.data : proposal?.completed ? proposal.nextCoordinator : undefined;
        if (!AgentID.safeParse(nextCoordinator).success) {
          const error = new Error('An active coordinator is required'); error.code = 'MANUAL_TAKEOVER_NO_COORDINATOR'; throw error;
        }
        args.push(nextCoordinator);
      }
    }
  }
  if (operation === 'command') {
    let body = JSON.parse(args[0]);
    if (!body.id) body.id = randomUUID();
    body = Command.parse(body);
    console.error(`Turnlink control command id=${body.id}`); // Preserve the retry key even if the response is lost; never log the body.
    if (body.op === 'worktree.approve') {
      const page = await client.request('control_query', { channel: body.channel, view: 'previews', entityID: body.previewID, limit: 1 });
      const disclosure = discloseWorktreeApproval(body, page);
      if (disclosure) console.error(JSON.stringify(disclosure));
    }
    console.log(JSON.stringify(await client.request('control_command', { command: body })));
  } else if (operation === 'worktree-review') {
    const [channel, previewID] = args;
    if (args.length !== 2) throw new Error('worktree-review requires a channel and preview UUID');
    const page = await client.request('control_query', { channel, view: 'previews', entityID: previewID, limit: 1 });
    if (!Array.isArray(page.entries) || page.entries.length !== 1) throw new Error('WORKTREE_PREVIEW_UNAVAILABLE');
    const preview = WorktreePreview.parse(page.entries[0]);
    if (preview.channel !== channel || preview.id !== previewID) throw new Error('WORKTREE_PREVIEW_UNAVAILABLE');
    const approval = worktreeApprovalForPreview(preview);
    const disclosure = discloseWorktreeApproval(approval, page);
    console.log(JSON.stringify({ preview, approval, ...(disclosure ? { disclosure } : {}) }));
  } else if (operation === 'managed-worktree-review') {
    const [channel, previewID] = args;
    if (args.length !== 2) throw new Error('managed-worktree-review requires a channel and managed preview UUID');
    const page = await client.request('control_query', { channel, view: 'managedPreviews', entityID: previewID, limit: 1 });
    if (!Array.isArray(page.entries) || page.entries.length !== 1) throw new Error('MANAGED_PREVIEW_UNAVAILABLE');
    console.log(JSON.stringify(managedWorktreeReview(page.entries[0], channel, previewID)));
  } else if (operation === 'managed-worktree-approve') {
    const [channel, previewID, suppliedID] = args;
    if (args.length < 2 || args.length > 3) throw new Error('managed-worktree-approve requires a channel, managed preview UUID and optional command UUID');
    const page = await client.request('control_query', { channel, view: 'managedPreviews', entityID: previewID, limit: 1 });
    if (!Array.isArray(page.entries) || page.entries.length !== 1) throw new Error('MANAGED_PREVIEW_UNAVAILABLE');
    const review = managedWorktreeReview(page.entries[0], channel, previewID);
    if (!review.approval && !suppliedID) throw new Error('MANAGED_PREVIEW_NOT_PENDING');
    const command = Command.parse({ id: suppliedID || randomUUID(), op: 'managed.approve', channel, previewID, digest: review.preview.digest });
    console.error(JSON.stringify({ commandID: command.id, warning: review.warning, preview: review.preview.preview }));
    console.log(JSON.stringify(await client.request('control_command', { command })));
  } else if (operation === 'query') {
    const [channel, view = 'channel', agentId] = args;
    console.log(JSON.stringify(await client.request('control_query', { channel, view, ...(agentId ? { agentId } : {}) })));
  } else if (operation === 'manual-resume-select') {
    const [channel, file, memberName] = args;
    if (args.length < 2 || args.length > 3) throw new Error('manual-resume-select requires a channel, an absolute new private selection-file path and optional exact member name');
    const { selection, review } = await selectManualResume(client, channel, memberName);
    saveManualSelection(file, selection);
    console.log(JSON.stringify({ selectionFile: file, review, guidance: manualResumeGuidance(review), limitations: manualResumeLimitations }));
  } else if (operation === 'manual-resume-review') {
    const [channel, taskID, previewID] = args;
    if (args.length !== 3) throw new Error('manual-resume-review requires a channel, task UUID and preview UUID');
    const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
    console.log(JSON.stringify({ ...review, guidance: manualResumeGuidance(review), limitations: manualResumeLimitations }));
  } else if (operation === 'manual-resume-authorize-host') {
    const [channel, taskID, previewID, targetHostId, suppliedID] = args;
    if (args.length < 4 || args.length > 5) throw new Error('manual-resume-authorize-host requires channel, task UUID, preview UUID, target host and optional transfer UUID');
    const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
    const transferID = suppliedID || (review.hostTransfer?.status !== 'cancelled' ? review.hostTransfer?.id : undefined) || randomUUID();
    console.error(`Turnlink host transfer id=${transferID}. This command confirms that the original session was stopped and authorizes host ${targetHostId}. Check the agent's report and resolve any pending external actions or background work before resuming.`);
    console.log(JSON.stringify(await client.request('control_manual_resume_authorize_host', { channel, taskID, previewID, targetHostId, transferID, sourceStopped: true })));
  } else if (operation === 'manual-resume-cancel-host') {
    const [channel, taskID, previewID, transferID] = args;
    if (args.length !== 4) throw new Error('manual-resume-cancel-host requires channel, task UUID, preview UUID and transfer UUID');
    console.log(JSON.stringify(await client.request('control_manual_resume_cancel_host', { channel, taskID, previewID, transferID })));
  } else if (operation === 'manual-resume-reset') {
    const [channel, taskID, previewID] = args;
    if (args.length !== 3) throw new Error('manual-resume-reset requires a channel, task UUID and preview UUID');
    const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
    console.error('Turnlink is retiring this manual preview. A new preview and approval will be required.');
    console.log(JSON.stringify(await client.request('control_manual_resume_reset', { channel, taskID, previewID, recordID: review.recordID })));
  } else if (operation === 'manual-resume-takeover') {
    const [channel, taskID, previewID, nextCoordinator, suppliedID] = args;
    if (args.length < 4 || args.length > 5) throw new Error('manual-resume-takeover requires channel, task UUID, preview UUID, new coordinator and optional takeover UUID');
    let proposal;
    if (suppliedID) {
      try {
        const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
        const prior = review.takeovers?.find(value => value.id === suppliedID && value.nextCoordinator === nextCoordinator);
        if (prior) proposal = { ...prior, takeoverID: prior.id, completed: true };
      } catch (error) { if (error.message !== 'MANUAL_RESUME_UNAVAILABLE') throw error; }
    }
    proposal ||= await client.request('control_manual_resume_takeover_prepare', { channel, taskID, previewID, nextCoordinator });
    const takeoverID = suppliedID || proposal.takeoverID || randomUUID();
    if ((proposal.pending || proposal.completed) && takeoverID !== proposal.takeoverID) throw new Error('A different coordinator takeover is already recorded');
    console.error(`Turnlink coordinator takeover id=${takeoverID}; the destination must still complete a fresh comparison before task execution.`);
    console.log(JSON.stringify(await client.request('control_manual_resume_takeover', { channel, taskID, previewID, takeoverID, nextCoordinator,
      previousCoordinator: proposal.previousCoordinator, previousRecordID: proposal.previousRecordID, nextRecordID: proposal.nextRecordID, generation: proposal.generation })));
  } else if (operation === 'manual-resume-takeover-cancel') {
    const [channel, taskID, previewID, takeoverID] = args;
    if (args.length !== 4) throw new Error('manual-resume-takeover-cancel requires channel, task UUID, preview UUID and takeover UUID');
    console.log(JSON.stringify(await client.request('control_manual_resume_takeover_cancel', { channel, taskID, previewID, takeoverID })));
  } else if (operation === 'manual-resume-confirm') {
    const [channel, taskID, previewID, suppliedID] = args;
    if (args.length < 3 || args.length > 4) throw new Error('manual-resume-confirm requires a channel, task UUID, preview UUID and optional receipt UUID');
    const review = await client.request('control_manual_resume_review', { channel, taskID, previewID });
    const receiptID = suppliedID || review.receiptID || randomUUID();
    if (review.status === 'confirmed' && receiptID !== review.receiptID || review.status !== 'confirmed' &&
      (review.status !== 'detached' || !review.connected || review.location !== review.to || review.report?.status !== 'reported_match'))
      throw new Error('Manual session comparison or receiver is not ready');
    console.error(`Turnlink manual resume receipt id=${receiptID}. This command records the operator's confirmation that the original session was stopped. Check and resolve any pending external actions or background work described in the agent's report before continuing.`);
    console.error(`Turnlink limitation: ${manualResumeLimitations[1]}`);
    console.log(JSON.stringify(await client.request('control_manual_resume_confirm', { channel, taskID, previewID, receiptID,
      recordID: review.status === 'confirmed' ? review.recordID : review.report.recordID,
      requestID: review.status === 'confirmed' ? review.requestID : review.report.requestID, sourceStopped: true })));
  } else if (operation === 'storage') {
    if (args.length) throw new Error('storage accepts no arguments');
    console.log(JSON.stringify(await client.request('control_storage_status')));
  } else if (operation === 'storage-reclaim') {
    const [id, digest] = args;
    if (args.length !== 2 || !/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('storage-reclaim requires an export UUID and its verified SHA-256 digest');
    console.log(JSON.stringify(await client.request('control_storage_reclaim', { id, digest })));
  } else if (operation === 'storage-reclaim-history') {
    const [id, digest, cutoff] = args, before = Number(cutoff);
    if (args.length !== 3 || !/^[a-f0-9]{64}$/.test(digest || '') || !/^(0|[1-9]\d*)$/.test(cutoff || '') || !Number.isSafeInteger(before))
      throw new Error('storage-reclaim-history requires an export UUID, its verified SHA-256 digest and a nonnegative Unix-millisecond cutoff');
    console.log(JSON.stringify(await client.request('control_storage_reclaim_history', { id, digest, before })));
  } else if (operation === 'activity') {
    const [channel, cursor = '0'] = args, after = Number(cursor);
    if (args.length > 2 || !channel || !Number.isSafeInteger(after) || after < 0) throw new Error('activity requires a channel and optional sequence cursor');
    console.log(JSON.stringify(await client.request('control_activity', { channel, after })));
  } else if (operation === 'activity-status') {
    if (args.length) throw new Error('activity-status accepts no arguments');
    console.log(JSON.stringify(await client.request('control_activity_status')));
  } else if (operation === 'receipt') {
    const [channel, commandID] = args;
    if (args.length !== 2) throw new Error('receipt requires a channel and original command UUID');
    console.log(JSON.stringify(await client.request('control_receipt', { channel, commandID })));
  } else if (operation === 'storage-watch') {
    if (args.length) throw new Error('storage-watch accepts no arguments');
    client.on('control_storage', ({ status }) => console.log(JSON.stringify(status)));
    const result = await client.request('control_storage_watch'); console.log(JSON.stringify(result.status));
    await new Promise(resolve => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      client.once('disconnected', () => { console.error('Turnlink storage monitor disconnected; reconnect explicitly.'); process.exitCode = 1; resolve(); });
    });
  } else if (operation === 'notifications-watch') {
    const [channel, interval = '15000'] = args;
    if (args.length < 1 || args.length > 2 || !/^[1-9]\d*$/.test(interval)) throw new Error('notifications-watch requires a channel and optional polling interval');
    const controller = new AbortController();
    const stop = reason => { if (!controller.signal.aborted) controller.abort(reason); client.close(); };
    const interrupted = () => stop();
    const disconnected = () => stop(new ControlError('NOTIFICATION_WATCH_DISCONNECTED'));
    const outputFailed = () => stop(new ControlError('NOTIFICATION_WATCH_OUTPUT'));
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
    client.once('disconnected', disconnected); process.stdout.on('error', outputFailed);
    try {
      await watchNotifications({ client, channel, intervalMs: Number(interval), signal: controller.signal,
        emit: frame => new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(frame)}\n`, error => error ? reject(error) : resolve())) });
    } finally {
      process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
      client.off('disconnected', disconnected); process.stdout.off('error', outputFailed);
    }
  } else if (operation === 'export') {
    const [file, suppliedID] = args, id = suppliedID || randomUUID();
    if (args.length > 2 || !file || !isAbsolute(file)) throw new Error('An absolute new private export-file path is required');
    console.error(`Turnlink control export id=${id}`); // Keep this exact ID for a lost-response retry; never regenerate it on retry.
    console.log(JSON.stringify(await downloadControlExport({ client, id, file })));
  } else if (operation === 'enroll-adapter') {
    const [hostId, file] = args;
    if (!file || !isAbsolute(file)) throw new Error('An absolute new private credential-file path is required');
    privateDirectory(dirname(file));
    const credential = randomBytes(32).toString('hex');
    writeFileSync(file, credential, { flag: 'wx', mode: 0o600 });
    // If enrollment fails, the protected file remains for operator inspection; never overwrite an existing credential file.
    await client.request('control_enroll_adapter', { hostId, credential });
    console.log(JSON.stringify({ enrolled: true, hostId, credentialFile: file }));
  } else if (operation === 'revoke-adapter') {
    console.log(JSON.stringify(await client.request('control_revoke_adapter', { hostId: args[0] })));
  } else throw new Error('Usage: control-admin command <JSON> | worktree-review <channel> <previewID> | managed-worktree-review <channel> <previewID> | managed-worktree-approve <channel> <previewID> [commandID] | manual-resume-select <channel> <private-file> [member-name] | manual-resume-review-selected <private-file> | manual-resume-authorize-selected <private-file> <targetHostId> [transferID] | manual-resume-confirm-selected <private-file> [receiptID] | manual-resume-cancel-selected <private-file> | manual-resume-reset-selected <private-file> | manual-resume-takeover-selected <private-file> | manual-resume-takeover-cancel-selected <private-file> | manual-resume-review <channel> <taskID> <previewID> | manual-resume-authorize-host <channel> <taskID> <previewID> <targetHostId> [transferID] | manual-resume-cancel-host <channel> <taskID> <previewID> <transferID> | manual-resume-reset <channel> <taskID> <previewID> | manual-resume-confirm <channel> <taskID> <previewID> [receiptID] | query <channel> <view> [agentId] | storage | storage-watch | storage-reclaim <exportID> <verified-sha256> | storage-reclaim-history <exportID> <verified-sha256> <before-unix-ms> | notifications-watch <channel> [intervalMs] | activity <channel> [after] | activity-status | receipt <channel> <commandID> | export <new-private-file> [id] | enroll-adapter <hostId> <new-private-file> | revoke-adapter <hostId>');
} catch (error) {
  console.error(`Turnlink control operation failed (${diagnosticCode(error)}). Check command syntax, enrollment and broker control status.`);
  if (error.code === 'MANUAL_SELECTION_AMBIGUOUS') console.error('Multiple manual moves are active in this channel; retry with the exact member name, or use the explicit task and preview commands.');
  if (error.code === 'MANUAL_SELECTION_UNAVAILABLE') console.error('No claimed manual move is currently available for review in this channel.');
  if (error.code === 'MANUAL_SELECTION_NAME_UNAVAILABLE') console.error('That member name was not found uniquely in this channel.');
  if (error.code === 'MANUAL_TAKEOVER_NO_COORDINATOR') console.error('An active coordinator is required; appoint and connect one before retrying the selected takeover.');
  if (error.code === 'MANUAL_TAKEOVER_NOT_PENDING') console.error('There is no pending takeover to cancel for the active coordinator.');
  if (operation === 'notifications-watch') console.error('Turnlink notification watch stopped; reconnect explicitly. Output is not acknowledgement or recovery authority.');
  if (error.partialFile) console.error(JSON.stringify({ partialExport: error.partialFile, verified: false }));
  process.exitCode = 1;
} finally { client?.close(); }
