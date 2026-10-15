import { digest } from './config.js';
import { requireControl as check } from './control/policy.js';

// Native RPC maps need not serialize keys in a stable order. Preserve array/rule order, normalize object keys.
const checksum = value => digest(JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
const activity = async read => {
  check(typeof read === 'function', 'NATIVE_ACTIVITY_REQUIRED');
  const value = await read();
  check(typeof value?.idle === 'boolean' && typeof value.blocked === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0, 'NATIVE_ACTIVITY_REQUIRED');
  return { idle: value.idle, blocked: value.blocked, revision: value.revision };
};

// Callbacks are bound by the adapter to its native context/RPC channel. No model arguments choose these observations.
export function makeOpenCodeSnapshotSource({ sessionID, readSession, readAgent, readTools, readInstructions, readConfiguration, readActivity, readResolvedModel }) {
  return async () => {
    const before = await activity(readActivity), session = await readSession();
    check(session?.id === sessionID && typeof session.agent === 'string' && session.location?.directory, 'TRANSITION_IDENTITY_MISMATCH');
    const [agent, tools, instructions, config] = await Promise.all([
      readAgent(session.agent), readTools(), readInstructions(), readConfiguration(),
    ]);
    check(agent?.id === session.agent && Array.isArray(agent.permissions) && Array.isArray(tools) && Array.isArray(instructions) && Array.isArray(config), 'NATIVE_SNAPSHOT_REQUIRED');
    const model = typeof readResolvedModel === 'function' ? await readResolvedModel(session, agent) : session.model;
    check(model && typeof model.providerID === 'string' && typeof model.id === 'string', 'NATIVE_MODEL_REQUIRED');
    const override = session.model ?? agent.model;
    if (override) check(override.providerID === model.providerID && override.id === model.id, 'NATIVE_MODEL_REQUIRED');
    const afterSession = await readSession(), after = await activity(readActivity);
    check(afterSession.id === session.id && afterSession.location.directory === session.location.directory &&
      checksum({ agent: afterSession.agent, model: afterSession.model, permissions: afterSession.permissions }) ===
      checksum({ agent: session.agent, model: session.model, permissions: session.permissions }) && checksum(before) === checksum(after), 'NATIVE_SNAPSHOT_CHANGED');
    return { harness: 'opencode', sessionID, directory: session.location.directory, ...after, resolvedConfigurationDigest: checksum(config),
      authority: { selectedAgent: session.agent, model,
        permissions: { agent: agent.permissions, session: session.permissions ?? [] }, tools,
        agentDefinitionDigest: checksum(agent), instructionEntriesDigest: checksum(instructions) } };
  };
}

export function makeCodexSnapshotSource({ threadID, readThread, readTools, readConfiguration, readInstructions, readActivity }) {
  return async () => {
    const before = await activity(readActivity);
    const [thread, tools, config, instructions] = await Promise.all([readThread(), readTools(), readConfiguration(), readInstructions()]);
    check(thread?.thread?.id === threadID && typeof thread.cwd === 'string' && thread.model && thread.sandbox && thread.approvalPolicy !== undefined,
      'TRANSITION_IDENTITY_MISMATCH');
    check(Array.isArray(tools) && instructions !== undefined && config !== undefined, 'NATIVE_SNAPSHOT_REQUIRED');
    const afterThread = await readThread(), after = await activity(readActivity);
    const selection = value => ({ id: value.thread.id, cwd: value.cwd, model: value.model, modelProvider: value.modelProvider,
      sandbox: value.sandbox, approvalPolicy: value.approvalPolicy });
    check(checksum(selection(thread)) === checksum(selection(afterThread)) && checksum(before) === checksum(after), 'NATIVE_SNAPSHOT_CHANGED');
    return { harness: 'codex', sessionID: threadID, directory: thread.cwd, ...after, resolvedConfigurationDigest: checksum(config),
      authority: { model: { model: thread.model, provider: thread.modelProvider }, permissions: {}, tools,
        sandbox: thread.sandbox, approvalPolicy: thread.approvalPolicy, instructionEntriesDigest: checksum(instructions) } };
  };
}
