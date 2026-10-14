import { randomUUID } from 'node:crypto';
import { effectFingerprint, BROKER_EFFECT_OPERATIONS } from './control/effects.js';
import { requireControl as check } from './control/policy.js';

// The receipt and its local effect live in ONE legacy broker snapshot; never write either independently.
export function applyBrokerEffect(previous, action, now) {
  check(BROKER_EFFECT_OPERATIONS.includes(action.operation), 'CONTROL_OPERATION_DISABLED');
  const prior = previous.effectReceipts?.[action.id];
  const fingerprint = effectFingerprint(action);
  if (prior) { check(prior.fingerprint === fingerprint, 'EFFECT_RECEIPT_CONFLICT'); return { state: previous, receipt: prior }; }
  check(Object.keys(previous.effectReceipts || {}).length < 4096, 'BROKER_EFFECT_RECEIPTS_FULL');
  const state = structuredClone(previous), member = state.agents[action.target];
  let outcome = 'succeeded';
  if (!member || member.channel !== action.channel) outcome = 'failed';
  else if (action.operation === 'cancel_queued') {
    const message = state.messages.find(m => m.id === action.messageID && m.channel === action.channel && m.recipients.includes(action.target));
    // Missing exposure metadata is legacy/unknown, not proof of non-admission. Once offered, cancellation cannot retract native work.
    if (!message || !Array.isArray(message.offered) || message.offered.includes(action.target) ||
      message.delivered.includes(action.target) || message.cancelled[action.target]) outcome = 'failed';
    else message.cancelled[action.target] = 'control_cancelled_unoffered';
  } else {
    state.deliveryPauses ??= {};
    if (action.operation === 'pause_delivery') state.deliveryPauses[action.target] = { channel: action.channel, actionID: action.id };
    else delete state.deliveryPauses[action.target];
  }
  const receipt = { id: randomUUID(), channel: action.channel, target: action.target, fingerprint, outcome, at: now };
  state.effectReceipts ??= {}; state.effectReceipts[action.id] = receipt;
  return { state, receipt };
}
