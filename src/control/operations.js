export const PARTICIPANT_OPERATIONS = Object.freeze(['master.volunteer', 'master.accept', 'master.resign', 'election.start', 'election.vote',
  'action.request', 'incident.open', 'incident.resolve', 'task.create', 'task.claim', 'task.release', 'task.report', 'task.review', 'task.reassign', 'worktree.session_require', 'worktree.manual_preview']);
export const OPERATOR_OPERATIONS = Object.freeze(['channel.configure', 'master.appoint', 'master.revoke', 'action.approve', 'action.reject',
  'incident.open', 'incident.resolve', 'task.create', 'task.reassign', 'task.missed', 'worktree.approve', 'managed.approve', 'managed.reject', 'managed.confirm_manual']);
export const ADAPTER_OPERATIONS = Object.freeze(['master.renew', 'evidence.record', 'worktree.preview', 'worktree.begin', 'worktree.settle', 'task.admission', 'task.started', 'task.progress', 'task.stopped', 'task.uncertain',
  'managed.preview', 'managed.begin', 'managed.revalidate', 'managed.settle']);
