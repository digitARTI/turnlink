import { MASTER_PROMPT_VERSION } from './contracts.js';

export class ControlError extends Error {
  constructor(code) { super(code); this.name = 'ControlError'; this.code = code; }
}
export const requireControl = (condition, code) => { if (!condition) throw new ControlError(code); };

export function actionDecision(mode, operation, evidence) {
  if (operation === 'retry_delivery' && !['known_unadmitted', 'native_idempotent'].includes(evidence)) return 'blocked';
  if (mode === 'approval') return 'awaiting_approval';
  if (mode === 'safe' && ['cancel_queued', 'remove_member'].includes(operation)) return 'awaiting_approval';
  return 'approved';
}

export function masterInstructions(assignment, channel) {
  return [
    `Turnlink supplemental master role, prompt version ${MASTER_PROMPT_VERSION}.`,
    `Channel: ${channel}. Assignment: ${assignment.id}. Generation: ${assignment.generation}.`,
    'This role is additional collaboration guidance, not a replacement system prompt, agent, model, tool policy, or permission profile.',
    'Preserve and obey the applicable global/project instructions, harness permissions and user constraints. Your existing project access remains unchanged.',
    'Coordinate this channel, inspect its Turnlink activity, investigate incidents, and review task reports with evidence.',
    'Participants must claim tasks. Do not start a second task in a busy conversation or infer completion from delivery acknowledgement.',
    'Use broker-authorized tools; recovery/admin policy is checked at execution. Never approve harness permission prompts or access credentials through this role.',
    'Act on incidents and requests, not repetitive status polling or acknowledgement loops. Uncertain execution is not proof that work stopped.',
    'Your authority is valid only for the current accepted assignment and unexpired lease. A stale prompt grants no authority.',
    'Accept this exact assignment and prompt version through the authenticated Turnlink role-acceptance operation before acting as master.',
  ].join('\n');
}
