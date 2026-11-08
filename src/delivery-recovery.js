import { stableID } from './control/effects.js';

// Recovery grants are read through the receiver-authenticated control transport,
// never through peer message text or caller-supplied message metadata.
export function makeDeliveryRecovery({ client, enabled, credential }) {
  const recorded = new Set();
  const pull = async (agentId, messageID) => {
    if (!enabled || !(await client.request('control_info')).effectsEnabled) return { policy: 'steer', retry: null, controlled: false };
    return { ...await client.request('control_delivery_pull', { agentId, messageID, credential: credential() }), controlled: true };
  };
  const observe = async (agentId, message, kind, admissionID, actionID) => {
    if (!enabled) return;
    const key = `${agentId}:${message.id}:${kind}:${admissionID || ''}:${actionID || ''}`;
    if (recorded.has(key)) return;
    await client.request('control_adapter', { agentId, credential: credential(), command: { id: stableID(key, 'native-delivery-observation'), op: 'evidence.record',
      channel: message.channel, entityID: message.id, kind, ...(admissionID ? { admissionID } : {}) } });
    recorded.add(key);
    if (recorded.size > 2048) recorded.delete(recorded.values().next().value);
  };
  const finish = (agentId, retry, outcome, admissionID) => retry ? client.request('control_delivery_finish', {
    agentId, credential: credential(), actionID: retry.id, outcome, ...(admissionID ? { admissionID } : {}),
  }) : Promise.resolve();
  return { pull, observe, finish };
}
