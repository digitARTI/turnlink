// Guidance is informational. It does not replace any broker authorization or
// attest that a native process or an external action has stopped.
export const manualResumeLimitations = Object.freeze([
  'The operator must verify that the source session has stopped and resolve background or external work before resuming.',
  'The agent comparison is a report, not independent proof of all loaded instructions, tools or policies at the destination.',
]);

export function manualResumeGuidance(review) {
  if (review?.status === 'confirmed') return { step: 'await_task',
    message: review.sourceRecord ? 'The operator confirmation is recorded. Check the task status for execution and review.' :
      'The operator confirmation is recorded, but the original record is unavailable. Inspect the task and retained history.' };
  if (review?.hostTransferAttemptsExhausted === true) {
    if (['armed', 'uncertain'].includes(review.status) && review.connected && review.location === review.from)
      return { step: 'reset_preview', message: 'The host transfer retry limit is reached. Reset this preview while the original source is connected, then create and approve a new preview.' };
    return { step: 'recover_source', message: 'The host transfer retry limit is reached. Reconnect the original session at the source, reset this preview, then create and approve a new preview.' };
  }
  if (!review?.sourceRecord) return { step: 'restore_record',
    message: 'The original session record is unavailable. Restore it or restart preparation from the source; do not confirm the move.' };
  if (review.status === 'uncertain') return { step: 'recover_source',
    message: 'Reconnect the original session at the source and prepare a fresh record before retrying.' };
  if (review.status === 'armed') return { step: 'stop_source',
    message: 'Review the source record and outstanding work, then stop the original session before authorizing or resuming it elsewhere.' };
  if (review.status !== 'detached') return { step: 'inspect', message: 'Inspect the move status before taking further action.' };
  if (!review.connected) return { step: 'resume_destination',
    message: ['pending', 'completed'].includes(review.hostTransfer?.status)
      ? 'Resume the original session on the authorized destination host.'
      : 'Resume the original session at the destination; authorize the destination host first if it is different.' };
  if (review.location !== review.to) return { step: 'inspect_location',
    message: 'The connected session is not at the approved destination. Inspect its location before continuing.' };
  if (review.report?.status === 'reported_match') return { step: 'confirm',
    message: 'Review the comparison and outstanding work, then confirm only after stopping the original session.' };
  if (['differences', 'incomplete', 'invalid_record', 'invalid_report'].includes(review.report?.status)) return { step: 'resolve_comparison',
    message: 'The comparison is incomplete, different or invalid. Review the report and resolve it before confirming.' };
  return { step: 'await_comparison', message: 'Wait for or request the resumed agent’s session comparison before confirming.' };
}
