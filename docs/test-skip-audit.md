# Test skip audit

On 2026-11-08, the macOS/Node 24 default suite for the supported branch
reported **781 passes, 43 skips and no failures**. Skipped checks are not
counted as passes. They include platform-specific Windows and Linux cases and
opt-in desktop, Docker, VM and official-runtime integration checks; each test
file states its own prerequisites.

The experimental automatic-transfer and modified-runtime test suites are
archived on `experimental/native-transfer`, not run in the supported suite.
Separately, isolated tests with the installed official Codex and OpenCode
programs covered the terminal receiver, proxy/worktree flow and OpenCode
service and TUI. A real Claude Desktop monitor test reconstructed ten numbered
parts without a history query; the interface can still truncate notification
metadata, and missing parts require a history query before acknowledgement.
