#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ChannelClient } from './client.js';
import { AgentID, Channel } from './protocol.js';
import { readPrivate } from './storage.js';
import { adminToken, validateCredential } from './config.js';
import { diagnosticCode } from './diagnostics.js';
import { ManualManagedWorktreeHost } from './manual-managed-worktree-host.js';
import { ControlError } from './control/policy.js';
import { retryBrokerPreDispatch } from './broker-rate-limit.js';

const absolute = z.string().min(1).max(2048).refine(isAbsolute);
const Settings = z.strictObject({ version: z.literal(1), agentId: AgentID, channel: Channel, repository: absolute,
  directory: absolute, worktreeRoot: absolute, adapterCredentialFile: absolute, credentialDirectory: absolute.optional() });
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const [operation, settingsPath, ...args] = process.argv.slice(2);
let client, operator, subscribed = false, agentId;
const controller = new AbortController();
const withPreDispatchRetry = value => {
  const request = value.request.bind(value);
  value.request = (...args) => retryBrokerPreDispatch(() => request(...args), { signal: controller.signal,
    check: () => { if (value.closed) throw new Error('Client is closed'); } });
  return value;
};
try {
  if (!settingsPath || !isAbsolute(settingsPath)) throw new Error('An absolute private settings file is required');
  const settings = Settings.parse(JSON.parse(readPrivate(settingsPath, 16384)));
  agentId = settings.agentId;
  if (!['preview-create', 'preview-remove', 'create', 'remove', 'recover'].includes(operation)) throw new Error('Unknown manual worktree operation');
  if ((operation === 'preview-create' && (args.length < 2 || args.length > 3)) ||
      (operation === 'preview-remove' && args.length !== 1) || (operation === 'recover' && args.length !== 0) ||
      (['create', 'remove'].includes(operation) && (args.length !== 3 || args[2] !== '--confirm-no-active-use')))
    throw new Error('Invalid manual worktree arguments');
  if (operation === 'preview-create') { uuid.parse(args[0]); if (!/^[1-9][0-9]*$/.test(args[1]) || !Number.isSafeInteger(Number(args[1]))) throw new Error('Invalid claim generation'); }
  if (operation === 'preview-remove') uuid.parse(args[0]);
  if (['create', 'remove'].includes(operation)) { uuid.parse(args[0]); digest.parse(args[1]); }
  client = withPreDispatchRetry(new ChannelClient({ ...(settings.credentialDirectory ? { credentialDirectory: settings.credentialDirectory } : {}) }));
  const resumed = await client.request('resume', { agentId });
  if (!resumed.registered || client.admin) throw new ControlError('MANUAL_WORKTREE_SESSION_UNAVAILABLE');
  const info = await client.request('control_info');
  if (!info.managedWorktreeRecordsEnabled) throw new ControlError('MANAGED_WORKTREE_RECORDS_DISABLED');
  let receiver;
  try { receiver = await client.subscribe(agentId, { manualWorktreeHost: true }); }
  catch (error) { if (error.message === 'Session already has a receiver') throw new ControlError('MANUAL_WORKTREE_RECEIVER_BUSY'); throw error; }
  subscribed = true;
  if (!receiver.registered || receiver.channel !== settings.channel) throw new ControlError('MANUAL_WORKTREE_SESSION_UNAVAILABLE');
  if (['create', 'remove'].includes(operation)) {
    operator = withPreDispatchRetry(new ChannelClient({ token: adminToken(false) }));
    await operator.connect();
    if (!operator.admin) throw new ControlError('MANUAL_WORKTREE_OPERATOR_REQUIRED');
  }
  const credential = () => validateCredential(readPrivate(settings.adapterCredentialFile, 128).trim());
  const operatorGuard = async scope => {
    if (!operator?.admin) return false;
    const page = await operator.request('control_query', { channel: scope.channel, view: 'managedPreviews', entityID: scope.previewID, limit: 1 });
    const value = page.entries?.length === 1 ? page.entries[0] : undefined;
    return operator.admin === true && value?.id === scope.previewID && value.channel === scope.channel && value.agentId === scope.agentId &&
      value.status === 'executing' && value.digest === scope.digest && value.preview?.kind === scope.operation &&
      value.manualConfirmation?.id === scope.confirmationID && value.manualConfirmation.scope === 'operator-confirms-no-active-use';
  };
  const host = new ManualManagedWorktreeHost({ client, hostId: client.hostId, channel: settings.channel, credential,
    repository: settings.repository, directory: settings.directory, worktreeRoot: settings.worktreeRoot, agentId, enabled: true, operatorGuard });
  let result;
  if (operation === 'preview-create') result = await host.previewCreate(args[0], Number(args[1]), args[2] || 'HEAD');
  else if (operation === 'preview-remove') result = await host.previewRemove(args[0]);
  else if (operation === 'recover') result = await host.recover();
  else {
    console.error('Operator confirmation: no session or external/background work is using the repository or target worktree. This is an attestation, not automatic native exclusion.');
    const confirmationID = randomUUID();
    console.error(`Operator confirmation id=${confirmationID}`);
    await operator.request('control_command', { command: { id: confirmationID, op: 'managed.confirm_manual', channel: settings.channel,
      previewID: args[0], digest: args[1], acknowledgement: 'operator-confirms-no-active-use' } });
    result = await host.executeConfirmed(operation, args[0], args[1], 'operator-confirms-no-active-use', confirmationID);
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Manual managed worktree failed (${diagnosticCode(error)})`);
  process.exitCode = 1;
} finally {
  if (subscribed) { try { await client.unsubscribe(agentId); } catch { /* Closing the socket releases its receiver. */ } }
  operator?.close();
  client?.close();
  controller.abort();
}
