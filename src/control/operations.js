export const PARTICIPANT_OPERATIONS = Object.freeze(['master.volunteer', 'master.accept', 'master.resign', 'election.start', 'election.vote',
  'action.request', 'incident.open', 'incident.resolve', 'task.create', 'task.claim', 'task.release', 'task.report', 'task.review', 'task.reassign']);
export const OPERATOR_OPERATIONS = Object.freeze(['channel.configure', 'master.appoint', 'master.revoke', 'action.approve', 'action.reject',
  'incident.open', 'incident.resolve', 'task.create', 'task.reassign', 'task.missed', 'worktree.approve']);
export const ADAPTER_OPERATIONS = Object.freeze(['master.renew', 'evidence.record', 'worktree.preview', 'task.admission', 'task.started', 'task.progress', 'task.stopped']);
