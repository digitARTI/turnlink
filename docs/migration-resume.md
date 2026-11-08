# Manual session migration

Gate 2 is closed for the operator-supervised stop-and-resume workflow. The
operator confirms source shutdown and checks external or background work; the
stock runtimes do not provide Turnlink independent proof of those conditions.

## Supported workflow

1. Ask the source agent for a session record and a report on pending work.
2. Review and resolve external or background work, then stop the source.
3. Confirm the stop to Turnlink and resume the same session at the destination.
4. Compare the destination session with the saved record and review any differences.

Turnlink cannot independently prove that every external process or background
operation has stopped. The operator must confirm those conditions before resume.
For managed worktree creation and cleanup see [worktree lifecycle](worktree-lifecycle.md).

Automatic live transfer and native writer exclusion are not supported. Historical
experiments and development evidence are retained in the experimental branch.

If an existing store contains an unresolved receiver handoff from the retired
automatic-transfer experiment, this release keeps it fenced and does not clear
it automatically. Inspect and resolve that state before using the affected
session.
