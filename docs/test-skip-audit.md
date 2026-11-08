# Test skip audit

On 2026-11-08, the macOS/Node 24 default suite reported 912 passes, 91 skips,
and no failures. This run followed the retirement of tests dedicated to the
abandoned automatic-transfer and modified-runtime experiments. One additional
skipped, patched-runtime Linux VM test was removed after that run.

The remaining skips are conditional checks such as Windows and Linux-specific
behavior, opt-in Docker/VM and desktop integration, and official installed
runtime or model integration. Each file states its prerequisites. Skipped
checks are not counted as passes; tests using remote hosts or hosted models
require their own configuration and authorization.

Before the retirement, additional isolated runs passed seven official-runtime
checks: two Codex continuity probes, the unsupported Node seal check, a Codex
TUI test, a Codex proxy/worktree test, and two OpenCode service/TUI tests.
