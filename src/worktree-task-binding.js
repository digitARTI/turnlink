import { WorktreePreview, WorktreeTransition } from './control/contracts.js';
import { requireControl as check } from './control/policy.js';

// This verifies the staged broker handoff, not native placement authority.
export async function releasedWorktreeTransition({ client, agentId, channel, credential, task }) {
  check(task.requiresWorktree && task.claimant === agentId && task.channel === channel && task.executionScope, 'TASK_SCOPE_REQUIRED');
  const entries = async view => {
    const all = [];
    for (let offset = 0, i = 0; i < 4096; i++) {
      const page = await client.request('control_query', { agentId, channel, view, offset, limit: 100 });
      check(Array.isArray(page.entries), 'TASK_RECEIVER_REQUIRED');
      all.push(...page.entries);
      if (!page.entries.length || page.next <= offset) return all;
      offset = page.next;
    }
    check(false, 'TASK_RECEIVER_REQUIRED');
  };
  const previews = (await entries('previews')).map(v => WorktreePreview.parse(v));
  const preview = previews.filter(v => v.agentId === agentId && v.taskID === task.id).at(-1);
  if (preview?.manualResume) {
    check(preview.channel === channel && preview.approved && preview.claimGeneration === task.claimGeneration &&
      preview.to === task.executionScope.cwd && preview.sessionCoordinator, 'TASK_RECEIVER_REQUIRED');
    const manual = await client.request('control_manual_resume_observe', { agentId, channel, credential, taskID: task.id,
      previewID: preview.id, cwd: task.executionScope.cwd });
    check(manual?.previewID === preview.id && typeof manual.receiptID === 'string' && manual.sourceStopEvidence === 'operator_attestation', 'TASK_RECEIVER_REQUIRED');
    return manual.receiptID;
  }
  const transitions = (await entries('transitions')).map(v => WorktreeTransition.parse(v));
  const transition = transitions.filter(v => v.agentId === agentId && v.taskID === task.id).at(-1);
  check(transition && !transition.purpose && transition.channel === channel && transition.claimGeneration === task.claimGeneration &&
    transition.status === 'moved' && transition.receiptID && transition.to === task.executionScope.cwd && transition.actualLocation === transition.to,
  'TASK_RECEIVER_REQUIRED');
  check(preview && !preview.purpose && preview.id === transition.previewID && preview.channel === channel && preview.approved &&
    preview.claimGeneration === task.claimGeneration && preview.from === transition.from && preview.to === transition.to &&
    preview.configurationDigest === transition.configurationDigest, 'TASK_RECEIVER_REQUIRED');
  const receiver = await client.request('control_receiver_observe', { agentId, channel, credential, transitionID: transition.id });
  check(receiver.status === 'released' && receiver.sourceDetached === true && receiver.transitionID === transition.id, 'TASK_RECEIVER_REQUIRED');
  return transition.id;
}
